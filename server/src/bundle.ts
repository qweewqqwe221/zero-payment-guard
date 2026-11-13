// Bundles: company brief (enrich + homepage/about Markdown in one call) and multi-URL page extraction.
import { domainEnrich } from "./enrich";
import { pageExtract } from "./extract";

export async function companyBrief(q: Record<string, string>) {
  const e = await domainEnrich({ domain: q.domain || q.email || q.url || "" });
  if (e.status !== 200) return e;
  const b = e.body; const home = b.website?.finalUrl || `https://${b.domain}/`;
  const about = b.website?.pages?.about || null;
  const maxChars = String(Math.min(Math.max(parseInt(q.maxChars || "6000") || 6000, 500), 20000));
  const [h, a] = await Promise.all([pageExtract({ url: home, maxChars }), about ? pageExtract({ url: about, maxChars }) : Promise.resolve(null)]);
  const pick = (r: any) => (r && r.status === 200 ? { url: r.body.finalUrl, title: r.body.title, markdown: r.body.markdown, wordCount: r.body.wordCount, truncated: r.body.truncated } : r ? { error: r.body.error || "unavailable" } : null);
  return { status: 200, body: { ...b, homepage: pick(h), aboutPage: pick(a) } };
}

export async function pageExtractBatch(q: Record<string, string>, all: Record<string, string[]>) {
  const raw = [...(all.url || []), ...((q.urls || "").split(/[\s,]+/))].map(s => s.trim()).filter(Boolean);
  const urls = [...new Set(raw)];
  if (!urls.length) return { status: 400, body: { error: "give urls=<url1>,<url2>,... (or repeat url=), up to 10" } };
  if (urls.length > 10) return { status: 400, body: { error: "max 10 urls per call (not charged)" } };
  const maxChars = String(Math.min(Math.max(parseInt(q.maxChars || "8000") || 8000, 500), 30000));
  const res = await Promise.all(urls.map(u => pageExtract({ url: u, maxChars, links: q.links || "0" }).catch(() => ({ status: 500, body: { error: "fetch failed" } }))));
  const results = res.map((r, i) => (r.status === 200 ? { ok: true, ...r.body } : { ok: false, url: urls[i], status: r.status, ...r.body }));
  const okCount = results.filter(r => r.ok).length;
  if (!okCount) return { status: 422, body: { error: "no url could be extracted (not charged)", results } };
  return { status: 200, body: { count: urls.length, ok: okCount, failed: urls.length - okCount, results } };
}
