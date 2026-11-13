// Web page -> clean markdown + metadata. Fetches one public URL on the caller's request, honours robots.txt, blocks private hosts.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { NodeHtmlMarkdown } from "node-html-markdown";

export const UA_TOKEN = "ZEROPageExtract";
const UA = `Mozilla/5.0 (compatible; ${UA_TOKEN}/1.0; +https://zero-payment-guard.worker.beacon.host/)`;
const MAX_BYTES = 3_000_000;

function badHost(h: string): boolean {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa") || !h.includes(".") && !h.includes(":")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const [a, b] = [+m[1], +m[2]];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  if (h.includes(":")) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:") || h === "::";
  return false;
}
function checkUrl(s: string): URL | string {
  let u: URL; try { u = new URL(s); } catch { return "invalid url"; }
  if (!/^https?:$/.test(u.protocol)) return "only http/https urls";
  if (u.username || u.password) return "credentials in url not allowed";
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) return "port not allowed";
  if (badHost(u.hostname)) return "private or local host not allowed";
  return u;
}
const timed = (ms: number) => AbortSignal.timeout(ms);

async function robotsAllowed(u: URL): Promise<boolean> {
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { "user-agent": UA }, signal: timed(3000), redirect: "follow" });
    if (!r.ok) return true; // missing robots.txt = allowed
    const txt = (await r.text()).slice(0, 200_000);
    const groups: { agents: string[]; rules: [boolean, string][] }[] = []; let cur: any = null, lastWasAgent = false;
    for (let line of txt.split(/\r?\n/)) {
      line = line.replace(/#.*/, "").trim(); const i = line.indexOf(":"); if (i < 0) continue;
      const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
      if (k === "user-agent") { if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
      else { lastWasAgent = false; if (cur && (k === "allow" || k === "disallow")) cur.rules.push([k === "allow", v]); }
    }
    const mine = groups.filter(g => g.agents.some(a => a !== "*" && UA_TOKEN.toLowerCase().includes(a)));
    const rules = (mine.length ? mine : groups.filter(g => g.agents.includes("*"))).flatMap(g => g.rules);
    const path = u.pathname + u.search; let best = -1, allow = true;
    for (const [al, pat] of rules) {
      if (!pat) continue;
      const re = new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (re.test(path) && pat.length > best || (re.test(path) && pat.length === best && al)) { best = pat.length; allow = al; }
    }
    return allow;
  } catch { return true; }
}

function cleanMd(md: string): string {
  return md
    .replace(/(?<!!)\[\]\([^)]*\)/g, "")                 // empty links (vote arrows, icon links)
    .replace(/!\[\]\(data:[^)]*\)/g, "")
    .replace(/^#{1,6}\s*$/gm, "")                     // empty headings
    .replace(/(\|[^\n]*?) {2,}/g, (m) => m.replace(/ {2,}/g, " ")) // table cell padding
    .replace(/^\|[\s|]*\|\s*$/gm, (m) => (/-/.test(m) ? m : "")) // empty table rows
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

type Out = { status: number; body: any };
export async function pageExtract(q: Record<string, string>): Promise<Out> {
  const c = checkUrl((q.url || "").trim());
  if (typeof c === "string") return { status: 400, body: { error: c } };
  const maxChars = Math.min(Math.max(parseInt(q.maxChars || "20000") || 20000, 500), 100000);
  const wantLinks = q.links === "1" || q.links === "true";
  if (!(await robotsAllowed(c))) return { status: 422, body: { error: "robots_disallowed", detail: "The site's robots.txt disallows this path for automated agents; not fetched, not charged." } };
  // follow redirects manually so every hop is re-validated
  let url = c, res: Response | null = null; const hops: string[] = [];
  for (let i = 0; i < 5; i++) {
    res = await fetch(url.toString(), { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5", "accept-language": "en;q=0.9,*;q=0.5" }, redirect: "manual", signal: timed(12000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const n = checkUrl(new URL(res.headers.get("location")!, url).toString());
      if (typeof n === "string") return { status: 422, body: { error: "redirect blocked: " + n } };
      hops.push(n.toString()); url = n; continue;
    }
    break;
  }
  if (!res || (res.status >= 300 && res.status < 400)) return { status: 422, body: { error: "too many redirects" } };
  if (res.status >= 400) return { status: 422, body: { error: "upstream_http_error", upstreamStatus: res.status, finalUrl: url.toString() } };
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const reader = res.body!.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; n += value.length; chunks.push(value); if (n > MAX_BYTES) { try { await reader.cancel(); } catch {} break; } }
  const buf = new Uint8Array(n > MAX_BYTES ? MAX_BYTES : n); let o = 0; for (const ch of chunks) { const s = ch.subarray(0, Math.min(ch.length, buf.length - o)); buf.set(s, o); o += s.length; if (o >= buf.length) break; }
  let charset = (ct.match(/charset=([\w-]+)/) || [])[1] || "utf-8"; let text: string;
  try { text = new TextDecoder(charset).decode(buf); } catch { text = new TextDecoder().decode(buf); }
  const base = { url: q.url, finalUrl: url.toString(), redirects: hops.length, httpStatus: res.status, contentType: ct.split(";")[0] || null, bytes: buf.length };
  if (ct.startsWith("text/plain") || ct.includes("markdown")) {
    const md = text.slice(0, maxChars); const wc = (text.match(/\S+/g) || []).length;
    const t1 = (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() || null;
    return { status: 200, body: { ...base, title: t1, extractor: "plain", markdown: md, truncated: text.length > maxChars, wordCount: wc, readingTimeMin: Math.max(1, Math.round(wc / 230)) } };
  }
  if (!ct.includes("html") && !/^\s*</.test(text.slice(0, 200))) return { status: 415, body: { ...base, error: "unsupported_content_type", detail: "Only HTML and plain text pages are supported (not charged)." } };

  const { document } = parseHTML(text) as any;
  const abs = (v: string | null) => { if (!v) return null; try { return new URL(v, url).toString(); } catch { return null; } };
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const og: Record<string, string> = {}, tw: Record<string, string> = {};
  for (const m of document.querySelectorAll("meta[property],meta[name]")) {
    const k = (m.getAttribute("property") || m.getAttribute("name") || "").toLowerCase(), v = (m.getAttribute("content") || "").trim();
    if (!v) continue; if (k.startsWith("og:") && !og[k.slice(3)]) og[k.slice(3)] = v; if (k.startsWith("twitter:") && !tw[k.slice(8)]) tw[k.slice(8)] = v;
  }
  const jsonLd: any[] = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent || ""); for (const it of (Array.isArray(j) ? j : j["@graph"] || [j])) jsonLd.push(it); } catch {} }
  const ldTypes = [...new Set(jsonLd.map(j => j && j["@type"]).flat().filter(Boolean))].slice(0, 20);
  const ldFirst = (k: string) => { for (const j of jsonLd) { const v = j?.[k]; if (v) return typeof v === "string" ? v : v.name || (Array.isArray(v) ? (v[0]?.name || v[0]) : null); } return null; };
  const icon = abs(document.querySelector('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]')?.getAttribute("href")) || abs("/favicon.ico");
  for (const a of document.querySelectorAll("a[href]")) { const v = abs(a.getAttribute("href")); if (v) a.setAttribute("href", v); }
  for (const im of document.querySelectorAll("img[src]")) { const v = abs(im.getAttribute("src")); if (v) im.setAttribute("src", v); }
  const allLinks = [...document.querySelectorAll("a[href]")].map((a: any) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120) })).filter(l => /^https?:/.test(l.href));
  const host = url.hostname; const internal = allLinks.filter(l => { try { return new URL(l.href).hostname === host; } catch { return false; } }).length;
  const headings = [...document.querySelectorAll("h1,h2,h3")].slice(0, 40).map((h: any) => ({ level: +h.tagName[1], text: (h.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200) })).filter(h => h.text);
  const titleTag = (document.querySelector("title")?.textContent || "").trim().replace(/\s+/g, " ") || null;
  const metadata = {
    title: og.title || titleTag, titleTag, description: meta('meta[name="description"]') || og.description || tw.description || null,
    canonical: abs(document.querySelector('link[rel="canonical"]')?.getAttribute("href")), lang: document.documentElement?.getAttribute("lang") || null,
    siteName: og.site_name || ldFirst("publisher") || null, author: meta('meta[name="author"]') || ldFirst("author"),
    published: meta('meta[property="article:published_time"]') || ldFirst("datePublished"), modified: meta('meta[property="article:modified_time"]') || ldFirst("dateModified"),
    image: abs(og.image || tw.image || null), favicon: icon, type: og.type || null, keywords: meta('meta[name="keywords"]'),
    robots: meta('meta[name="robots"]'), feeds: [...document.querySelectorAll('link[rel="alternate"][type*="rss"],link[rel="alternate"][type*="atom"]')].map((l: any) => abs(l.getAttribute("href"))).filter(Boolean).slice(0, 5),
  };
  let articleHtml: string | null = null, excerpt: string | null = null, byline: string | null = null;
  try {
    const clone = parseHTML(document.toString()).document;
    const art = new Readability(clone as any, { charThreshold: 300 }).parse();
    if (art?.content && (art.textContent || "").trim().length > 200) { articleHtml = art.content; excerpt = art.excerpt || null; byline = art.byline || null; }
  } catch {}
  for (const s of document.querySelectorAll("script,style,noscript,svg,nav,footer,form,iframe,template,[aria-hidden=true],[hidden]")) s.remove();
  const fbHtml = (document.querySelector("main,[role=main]") || document.body)?.innerHTML || "";
  const toMd = (h: string) => cleanMd(NodeHtmlMarkdown.translate(h, { keepDataImages: false, maxConsecutiveNewlines: 2 } as any));
  const words = (t: string) => (t.match(/\S+/g) || []).length;
  let extractor = "readability"; let md = articleHtml ? toMd(articleHtml) : "";
  if (!articleHtml || words(md) < 150) { const fb = toMd(fbHtml); if (!articleHtml || words(fb) > 3 * words(md)) { md = fb; extractor = "fallback"; } }
  const wc = (md.match(/\S+/g) || []).length; const truncated = md.length > maxChars; if (truncated) md = md.slice(0, maxChars);
  return { status: 200, body: { ...base, ...metadata, author: metadata.author || byline, excerpt: excerpt || metadata.description,
    og, twitter: tw, jsonLdTypes: ldTypes, headings, links: { total: allLinks.length, internal, external: allLinks.length - internal, ...(wantLinks ? { list: allLinks.slice(0, 150) } : {}) },
    markdown: md, truncated, wordCount: wc, readingTimeMin: Math.max(1, Math.round(wc / 230)), extractor } };
}
