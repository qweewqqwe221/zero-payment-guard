// Domain/company enrichment from public sources: DNS-over-HTTPS (Cloudflare/Google), RDAP (rdap.org bootstrap), and the site's public homepage (robots.txt honoured).
import { parseHTML } from "linkedom";
import { UA_TOKEN } from "./extract";
const UA = `Mozilla/5.0 (compatible; ${UA_TOKEN}/1.0; +https://zero-payment-guard.worker.beacon.host/)`;
const T = (ms: number) => AbortSignal.timeout(ms);

async function doh(name: string, type: string): Promise<string[]> {
  for (const base of ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: T(4000) });
      if (!r.ok) continue; const j: any = await r.json();
      if (j.Status !== 0 && j.Status !== 3) continue;
      return (j.Answer || []).filter((a: any) => a.type === ({ A: 1, AAAA: 28, MX: 15, TXT: 16, NS: 2, CNAME: 5, CAA: 257 } as any)[type]).map((a: any) => String(a.data).replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
    } catch {}
  }
  return [];
}
const MX_PROVIDERS: [RegExp, string][] = [[/google(mail)?\.com\.?$|googlemail/i, "Google Workspace"], [/outlook\.com\.?$|protection\.outlook/i, "Microsoft 365"], [/pphosted|proofpoint/i, "Proofpoint"], [/mimecast/i, "Mimecast"], [/zoho/i, "Zoho Mail"], [/protonmail|proton\.ch/i, "Proton Mail"], [/fastmail|messagingengine/i, "Fastmail"], [/secureserver\.net/i, "GoDaddy"], [/mail\.ovh|ovh\.net/i, "OVH"], [/yandex/i, "Yandex"], [/icloud|apple\.com/i, "iCloud"], [/amazonaws|awsapps/i, "Amazon SES/WorkMail"], [/barracuda/i, "Barracuda"], [/mailgun/i, "Mailgun"], [/improvmx/i, "ImprovMX"], [/forwardemail/i, "Forward Email"], [/cloudflare/i, "Cloudflare Email Routing"], [/hostinger|titan\.email/i, "Hostinger/Titan"], [/emailsrvr|rackspace/i, "Rackspace"], [/migadu/i, "Migadu"], [/messagelabs/i, "Broadcom Email Security (MessageLabs)"], [/iphmx\.com/i, "Cisco Secure Email"], [/mailcontrol\.com/i, "Forcepoint"], [/trendmicro|tmes\./i, "Trend Micro"], [/sophos/i, "Sophos"], [/hornetsecurity|antispameurope/i, "Hornetsecurity"], [/spamexperts|antispamcloud/i, "SpamExperts"], [/mxrecord\.io|mxrouting/i, "MXroute"], [/registrar-servers\.com/i, "Namecheap Email"], [/1and1|ionos/i, "IONOS"], [/hey\.com/i, "HEY"], [/mail\.ru/i, "Mail.ru"], [/qq\.com|exmail/i, "Tencent Exmail"], [/aliyun|alibaba/i, "Alibaba Mail"]];
const SPF_SERVICES: [RegExp, string][] = [[/_spf\.google\.com/, "Google Workspace"], [/spf\.protection\.outlook/, "Microsoft 365"], [/sendgrid/, "SendGrid"], [/mailgun/, "Mailgun"], [/amazonses/, "Amazon SES"], [/mcsv\.net|mandrillapp/, "Mailchimp/Mandrill"], [/servers\.mcsv|mailchimp/, "Mailchimp"], [/hubspot|hubspotemail/, "HubSpot"], [/salesforce|exacttarget/, "Salesforce"], [/zendesk/, "Zendesk"], [/freshdesk/, "Freshdesk"], [/postmark|mtasv/, "Postmark"], [/sparkpost/, "SparkPost"], [/intercom/, "Intercom"], [/klaviyo/, "Klaviyo"], [/zoho/, "Zoho"], [/atlassian/, "Atlassian"], [/stripe/, "Stripe"], [/shopify/, "Shopify"]];
const TXT_VERIFY: [RegExp, string][] = [[/^google-site-verification=/, "Google Search Console"], [/^MS=/, "Microsoft 365"], [/^facebook-domain-verification=/, "Meta"], [/^apple-domain-verification=/, "Apple"], [/^atlassian-domain-verification=/, "Atlassian"], [/^stripe-verification=/, "Stripe"], [/^docusign=/, "DocuSign"], [/^adobe-idp-site-verification=/, "Adobe"], [/^slack-domain-verification=/, "Slack"], [/^zoom-domain-verification|^ZOOM_verify/, "Zoom"], [/^hubspot-developer-verification|^hubspot/i, "HubSpot"], [/^openai-domain-verification=/, "OpenAI"], [/^anthropic-domain-verification/, "Anthropic"], [/^notion-domain-verification/i, "Notion"], [/^miro-verification=/, "Miro"], [/^dropbox-domain-verification=/, "Dropbox"], [/^asv=|^amazonses:/i, "Amazon"], [/^cisco-ci-domain-verification=/, "Cisco Webex"], [/^figma-domain-verification/i, "Figma"], [/^github-verification|^_github/i, "GitHub"], [/^1password-site-verification/i, "1Password"], [/^onetrust-domain-verification/i, "OneTrust"], [/^klaviyo-site-verification/i, "Klaviyo"], [/^mailchimp/i, "Mailchimp"], [/^twilio-domain-verification/i, "Twilio"], [/^vercel/i, "Vercel"]];
const NS_HOSTS: [RegExp, string][] = [[/cloudflare\.com\.?$/, "Cloudflare"], [/awsdns/, "Amazon Route 53"], [/googledomains|google\.com\.?$/, "Google Cloud DNS"], [/azure-dns/, "Azure DNS"], [/domaincontrol\.com/, "GoDaddy"], [/nsone\.net/, "NS1"], [/dnsimple/, "DNSimple"], [/vercel-dns/, "Vercel"], [/netlify/, "Netlify"], [/digitalocean/, "DigitalOcean"], [/registrar-servers|namecheap/, "Namecheap"], [/ultradns/, "UltraDNS"], [/akam/, "Akamai"], [/dynect/, "Oracle Dyn"], [/hetzner/, "Hetzner"], [/ovh\.net/, "OVH"], [/wixdns/, "Wix"], [/squarespacedns|squarespace/, "Squarespace"], [/shopify/, "Shopify"], [/porkbun/, "Porkbun"], [/gandi/, "Gandi"], [/name-services\.com|enom/, "Enom"]];
// [name, category, test over headers(lowercased "k: v" lines) + html]
const TECH: [string, string, RegExp][] = [
  ["Cloudflare", "CDN", /^server: cloudflare|^cf-ray:/m], ["Fastly", "CDN", /^x-served-by: cache-|^fastly-/m], ["Akamai", "CDN", /^(server: akamai|x-akamai)/m], ["Amazon CloudFront", "CDN", /cloudfront/], ["Vercel", "Hosting", /^server: vercel|^x-vercel-/m], ["Netlify", "Hosting", /^server: netlify|^x-nf-request-id/m],
  ["GitHub Pages", "Hosting", /^server: github\.com/m], ["Heroku", "Hosting", /heroku/], ["nginx", "Web server", /^server: nginx/m], ["Apache", "Web server", /^server: apache/m], ["Microsoft IIS", "Web server", /^server: microsoft-iis/m], ["LiteSpeed", "Web server", /^server: litespeed/m],
  ["Next.js", "Framework", /__next_data__|\/_next\/static|^x-powered-by: next\.js/mi], ["Nuxt", "Framework", /__nuxt|\/_nuxt\//i], ["Gatsby", "Framework", /___gatsby/], ["Astro", "Framework", /astro-island|\/_astro\//], ["SvelteKit", "Framework", /__sveltekit|\/_app\/immutable/], ["Remix", "Framework", /__remixcontext|__remix/i], ["Angular", "Framework", /ng-version=/], ["React", "JS library", /data-reactroot|react-dom|__next_data__/i], ["Vue.js", "JS library", /data-v-[0-9a-f]{8}|vue(\.runtime)?(\.global)?(\.prod|\.min)?\.js/i], ["jQuery", "JS library", /jquery[.-][\d.]*(min\.)?js/i],
  ["PHP", "Language", /^x-powered-by: php/m], ["ASP.NET", "Framework", /^x-powered-by: asp\.net|^x-aspnet-version/m], ["Express", "Framework", /^x-powered-by: express/m],
  ["WordPress", "CMS", /wp-content\/|wp-includes\/|<meta name="generator" content="wordpress/i], ["Drupal", "CMS", /drupal-settings-json|\/sites\/default\/files|x-generator: drupal/i], ["Joomla", "CMS", /\/media\/jui\/|content="joomla/i], ["Ghost", "CMS", /<meta name="generator" content="ghost/i], ["Webflow", "Site builder", /webflow\.(com|io)|data-wf-site/i], ["Wix", "Site builder", /wixstatic\.com|x-wix-request-id/i], ["Squarespace", "Site builder", /squarespace(-cdn)?\.com|static1\.squarespace/i], ["Framer", "Site builder", /framerusercontent|framer\.com\/m\//i], ["HubSpot CMS", "CMS", /hs-sites|hubspot\.net\/hub|hs-scripts\.com/i], ["Contentful", "CMS", /ctfassets\.net/], ["Sanity", "CMS", /cdn\.sanity\.io/],
  ["Shopify", "E-commerce", /cdn\.shopify\.com|myshopify\.com|^x-shopid:/mi], ["WooCommerce", "E-commerce", /wp-content\/plugins\/woocommerce/i], ["Magento", "E-commerce", /\/static\/version\d+\/frontend\/|Magento_[A-Z]/], ["BigCommerce", "E-commerce", /bigcommerce\.com/i], ["Stripe", "Payments", /js\.stripe\.com/], ["PayPal", "Payments", /paypal\.com\/sdk|paypalobjects/],
  ["Google Analytics", "Analytics", /googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/], ["Google Tag Manager", "Tag manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/], ["Segment", "Analytics", /cdn\.segment\.com/], ["Mixpanel", "Analytics", /cdn\.mxpnl\.com|mixpanel\.init/], ["Amplitude", "Analytics", /cdn\.amplitude\.com|amplitude\.getInstance/], ["Hotjar", "Analytics", /static\.hotjar\.com/], ["Plausible", "Analytics", /plausible\.io/], ["PostHog", "Analytics", /posthog\.init|i\.posthog\.com/], ["Heap", "Analytics", /heapanalytics\.com/], ["Meta Pixel", "Advertising", /connect\.facebook\.net|fbq\(/], ["LinkedIn Insight", "Advertising", /snap\.licdn\.com/], ["Microsoft Clarity", "Analytics", /clarity\.ms/],
  ["Intercom", "Chat/support", /widget\.intercom\.io|intercomsettings/i], ["Drift", "Chat/support", /js\.driftt\.com/], ["Zendesk", "Chat/support", /static\.zdassets\.com/], ["Crisp", "Chat/support", /client\.crisp\.chat/], ["HubSpot", "Marketing", /js\.hs-scripts\.com|js\.hs-analytics\.net|js\.hsforms\.net/], ["Marketo", "Marketing", /munchkin\.marketo\.net/], ["Klaviyo", "Marketing", /static\.klaviyo\.com/], ["Mailchimp", "Marketing", /chimpstatic|list-manage\.com/i],
  ["Cloudflare Turnstile", "Security", /challenges\.cloudflare\.com\/turnstile/], ["reCAPTCHA", "Security", /google\.com\/recaptcha|grecaptcha/], ["OneTrust", "Consent", /cdn\.cookielaw\.org|otSDKStub/], ["Cookiebot", "Consent", /consent\.cookiebot\.com/], ["Sentry", "Monitoring", /browser\.sentry-cdn\.com|ingest\.sentry\.io|sentry-trace/], ["Datadog RUM", "Monitoring", /datadoghq-browser-agent|DD_RUM/], ["Bootstrap", "CSS", /bootstrap(\.min)?\.(css|js)/i], ["Font Awesome", "Fonts", /font-?awesome[\w.-]*\.(css|js)|kit\.fontawesome\.com/i], ["Google Fonts", "Fonts", /fonts\.googleapis\.com/],
];
const SOCIAL: [string, RegExp][] = [["x", /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!share|intent|home|search|hashtag|i\/)[A-Za-z0-9_]{1,15}\/?$/], ["linkedin", /^https?:\/\/([a-z]+\.)?linkedin\.com\/(company|in|school|showcase)\/[^/?#]+/], ["github", /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/], ["facebook", /^https?:\/\/(www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr)[^/?#]+\/?$/], ["instagram", /^https?:\/\/(www\.)?instagram\.com\/[^/?#]+\/?$/], ["youtube", /^https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/|user\/)[^/?#]+/], ["tiktok", /^https?:\/\/(www\.)?tiktok\.com\/@[^/?#]+/], ["discord", /^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[^/?#]+/], ["telegram", /^https?:\/\/(t\.me|telegram\.me)\/[^/?#]+/], ["medium", /^https?:\/\/([a-z0-9-]+\.)?medium\.com\/?(@[^/?#]+)?/], ["crunchbase", /^https?:\/\/(www\.)?crunchbase\.com\/organization\/[^/?#]+/], ["pinterest", /^https?:\/\/(www\.)?pinterest\.[a-z.]+\/[^/?#]+\/?$/], ["reddit", /^https?:\/\/(www\.)?reddit\.com\/(r|user)\/[^/?#]+/], ["bluesky", /^https?:\/\/bsky\.app\/profile\/[^/?#]+/], ["mastodon", /^https?:\/\/(?!(www\.)?(youtube|tiktok|medium|threads)\.)[a-z0-9.-]+\/@[A-Za-z0-9_]+\/?$/], ["warpcast", /^https?:\/\/(warpcast\.com|farcaster\.xyz)\/[^/?#]+/]];

function normDomain(s: string): string | null {
  s = (s || "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!;
  try { if (/^[a-z]+:\/\//.test(s)) s = new URL(s).hostname; } catch { return null; }
  s = s.replace(/^www\./, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(s)) return null;
  if (/(^|\.)(localhost|local|internal|home\.arpa|lan)$/.test(s)) return null;
  return s;
}

async function rdap(domain: string) {
  try {
    const r = await fetch(`https://rdap.org/domain/${domain}`, { headers: { accept: "application/rdap+json", "user-agent": UA }, signal: T(7000), redirect: "follow" });
    if (!r.ok) {
      const viaRegistry = !!r.url && !r.url.startsWith("https://rdap.org/");
      if (r.status === 404 && viaRegistry) return { found: false };
      return { found: null, error: r.status === 404 ? "RDAP not offered for this TLD (registration data unavailable)" : `rdap http ${r.status}` };
    }
    const j: any = await r.json();
    const ev = (a: string) => (j.events || []).find((e: any) => e.eventAction === a)?.eventDate || null;
    const ent = (role: string) => (j.entities || []).find((e: any) => (e.roles || []).includes(role));
    const vcardName = (e: any) => { const v = e?.vcardArray?.[1] || []; return (v.find((x: any) => x[0] === "fn")?.[3] || v.find((x: any) => x[0] === "org")?.[3] || null) || null; };
    const reg = ent("registrar"); const registrant = ent("registrant");
    const regCountry = (() => { const v = registrant?.vcardArray?.[1] || []; const adr = v.find((x: any) => x[0] === "adr"); return adr?.[1]?.cc || (Array.isArray(adr?.[3]) ? adr[3][6] || null : null) || null; })();
    const created = ev("registration");
    const ageDays = created ? Math.floor((Date.now() - Date.parse(created)) / 86400000) : null;
    const rn = vcardName(registrant);
    return { found: true, registrar: vcardName(reg), registrarIanaId: (reg?.publicIds || []).find((p: any) => /iana/i.test(p.type))?.identifier || null,
      created, updated: ev("last changed"), expires: ev("expiration"), ageDays, status: j.status || [],
      registrant: rn && !/redacted|privacy|withheld|data protected|not disclosed/i.test(rn) ? rn : null, registrantCountry: regCountry || null,
      nameservers: (j.nameservers || []).map((n: any) => String(n.ldhName || "").toLowerCase()).filter(Boolean), dnssec: j.secureDNS?.delegationSigned ?? null };
  } catch (e) { return { found: null, error: "rdap unavailable" }; }
}

async function robotsOk(origin: string): Promise<boolean> {
  try { const r = await fetch(origin + "/robots.txt", { headers: { "user-agent": UA }, signal: T(3000) }); if (!r.ok) return true;
    const t = (await r.text()).slice(0, 100000).toLowerCase(); let applies = false, dis = false;
    for (let l of t.split(/\r?\n/)) { l = l.replace(/#.*/, "").trim(); if (l.startsWith("user-agent:")) { const a = l.slice(11).trim(); applies = a === "*" || UA_TOKEN.toLowerCase().includes(a); } else if (applies && l.startsWith("disallow:") && l.slice(9).trim() === "/") dis = true; else if (applies && l.startsWith("allow:") && l.slice(6).trim() === "/") dis = false; }
    return !dis; } catch { return true; }
}

async function site(domain: string) {
  for (const origin of [`https://${domain}`, `https://www.${domain}`]) {
    try {
      if (!(await robotsOk(origin))) return { fetched: false, reason: "robots.txt disallows the homepage" };
      const r = await fetch(origin + "/", { headers: { "user-agent": UA, accept: "text/html" }, signal: T(9000), redirect: "follow" });
      const finalUrl = r.url || origin; const fh = new URL(finalUrl).hostname.toLowerCase();
      if (!(fh === domain || fh.endsWith("." + domain) || fh.replace(/^www\./, "") === domain)) { /* redirected off-domain: report, still parse */ }
      const reader = r.body?.getReader(); let n = 0; const chunks: Uint8Array[] = [];
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; if (n > 1_500_000) { try { await reader.cancel(); } catch {} break; } }
      const html = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : new Uint8Array(chunks.flatMap(c => [...c])));
      const hdrs = [...r.headers].map(([k, v]) => `${k.toLowerCase()}: ${v.toLowerCase()}`).join("\n");
      const hay = hdrs + "\n" + html.slice(0, 600000);
      const tech = TECH.filter(([, , re]) => re.test(hay)).map(([name, category]) => ({ name, category }));
      const { document } = parseHTML(html) as any;
      const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() || null;
      const abs = (v: string | null) => { if (!v) return null; try { return new URL(v, finalUrl).toString(); } catch { return null; } };
      const hrefs: string[] = [...document.querySelectorAll("a[href]")].map((a: any) => abs(a.getAttribute("href"))).filter(Boolean) as string[];
      const socials: Record<string, string> = {};
      for (const h of hrefs) for (const [k, re] of SOCIAL) if (!socials[k] && re.test(h.split("?")[0])) socials[k] = h.split("?")[0];
      const emails = [...new Set([...html.matchAll(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map(m => m[1].toLowerCase()))].slice(0, 10);
      const phones = [...new Set([...html.matchAll(/tel:([+\d][\d\s().-]{6,20})/g)].map(m => m[1].trim()))].slice(0, 5);
      const ld: any[] = []; for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent || ""); for (const it of (Array.isArray(j) ? j : j["@graph"] || [j])) ld.push(it); } catch {} }
      const org = ld.find(x => /Organization|Corporation|LocalBusiness|Company/i.test(String(x?.["@type"])));
      for (const s of (org?.sameAs ? [].concat(org.sameAs) : [])) for (const [k, re] of SOCIAL) if (!socials[k] && re.test(String(s))) socials[k] = String(s);
      const findLink = (re: RegExp) => hrefs.find(h => { try { return new URL(h).pathname.match(re); } catch { return false; } }) || null;
      return { fetched: true, httpStatus: r.status, finalUrl, redirectedOffDomain: !(fh === domain || fh.endsWith("." + domain)),
        title: (document.querySelector("title")?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200) || null,
        description: meta('meta[name="description"]') || meta('meta[property="og:description"]'), siteName: meta('meta[property="og:site_name"]'),
        image: abs(meta('meta[property="og:image"]')), favicon: abs(document.querySelector('link[rel~="icon"]')?.getAttribute("href") || "/favicon.ico"),
        lang: document.documentElement?.getAttribute("lang") || null, generator: meta('meta[name="generator"]'),
        organization: org ? { name: org.name || null, legalName: org.legalName || null, logo: typeof org.logo === "string" ? org.logo : org.logo?.url || null, foundingDate: org.foundingDate || null, address: typeof org.address === "object" ? [org.address.streetAddress, org.address.addressLocality, org.address.addressRegion, org.address.postalCode, org.address.addressCountry?.name || org.address.addressCountry].filter(Boolean).join(", ") : org.address || null, telephone: org.telephone || null, email: org.email || null } : null,
        socials, emails, phones, tech,
        pages: { about: findLink(/^\/(about|company|about-us)\/?$/i), careers: findLink(/^\/(careers|jobs|join-us)\/?$/i), pricing: findLink(/^\/pricing\/?$/i), contact: findLink(/^\/(contact|contact-us)\/?$/i), blog: findLink(/^\/(blog|news)\/?$/i), privacy: findLink(/privacy/i) },
        security: { hsts: r.headers.has("strict-transport-security"), csp: r.headers.has("content-security-policy") } };
    } catch { continue; }
  }
  return { fetched: false, reason: "site unreachable over https" };
}

export async function domainEnrich(q: Record<string, string>): Promise<{ status: number; body: any }> {
  const domain = normDomain(q.domain || q.email || q.url || "");
  if (!domain) return { status: 400, body: { error: "give domain=example.com (or email= / url=)" } };
  const [a, aaaa, mx, txt, ns, dmarc, caa, rd, web] = await Promise.all([doh(domain, "A"), doh(domain, "AAAA"), doh(domain, "MX"), doh(domain, "TXT"), doh(domain, "NS"), doh(`_dmarc.${domain}`, "TXT"), doh(domain, "CAA"), rdap(domain), q.site === "0" ? Promise.resolve({ fetched: false, reason: "skipped (site=0)" }) : site(domain)]);
  const dnsEmpty = !a.length && !aaaa.length && !mx.length && !ns.length && !txt.length;
  if (dnsEmpty && rd.found !== true) return { status: 422, body: { domain, error: "domain_not_found", detail: "No DNS records and no RDAP registration found; not charged." } };
  const mxAll = mx.map(m => { const p = m.split(/\s+/); return { priority: +p[0], host: (p[1] || "").replace(/\.$/, "").toLowerCase() }; }).sort((x, y) => x.priority - y.priority);
  const nullMx = mxAll.length > 0 && mxAll.every(m => !m.host);
  const mxHosts = mxAll.filter(m => m.host);
  const mxProv = [...new Set(mxHosts.map(m => MX_PROVIDERS.find(([re]) => re.test(m.host))?.[1] || (m.host === domain || m.host.endsWith("." + domain) ? "Self-hosted" : null)).filter(Boolean))];
  const spf = txt.find(t => /^v=spf1/i.test(t)) || null;
  const dm = dmarc.find(t => /^v=dmarc1/i.test(t)) || null;
  const saas = [...new Set([...txt.flatMap(t => TXT_VERIFY.filter(([re]) => re.test(t)).map(([, n]) => n)), ...(spf ? SPF_SERVICES.filter(([re]) => re.test(spf)).map(([, n]) => n) : [])])];
  const nsHosts = ns.map(n => n.replace(/\.$/, "").toLowerCase());
  const dnsProvider = [...new Set(nsHosts.map(h => NS_HOSTS.find(([re]) => re.test(h))?.[1]).filter(Boolean))];
  const w: any = web;
  const companyName = w.organization?.name || w.siteName || (w.title ? w.title.split(/\s[|\-–—:·]\s/)[0].replace(/^(welcome to|home|homepage)\s*[-:|]?\s*/i, "").trim() || null : null);
  return { status: 200, body: {
    domain, company: { name: companyName, description: w.description || null, logo: w.organization?.logo || w.image || null, foundingDate: w.organization?.foundingDate || null, address: w.organization?.address || null, socials: w.socials || {}, emails: w.emails || [], phones: w.phones || [] },
    email: { mx: mxHosts, provider: mxProv[0] || (mxHosts.length ? "Other" : null), providers: mxProv, acceptsMail: mxHosts.length > 0, nullMx, spf, dmarc: dm, dmarcPolicy: (dm?.match(/;\s*p=(\w+)/i) || [])[1] || null },
    dns: { a, aaaa, ns: nsHosts, dnsProvider: dnsProvider[0] || null, caa, txtVerifications: saas },
    registration: rd, website: web,
    techStack: w.tech || [], saasSignals: saas,
    sources: ["DNS over HTTPS (Cloudflare 1.1.1.1 / Google)", "RDAP via rdap.org (IANA bootstrap)", w.fetched ? "public homepage (robots.txt honoured)" : null].filter(Boolean),
  } };
}
