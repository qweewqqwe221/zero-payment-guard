import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { CachedFacilitatorClient } from "./fac";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import { verifyUsdcPayment, preflightX402 } from "./checks";
import { tokenCheck, basename } from "./checks2";
import { walletSnapshot, txStatus } from "./checks3";
import { pageExtract } from "./extract";
import { domainEnrich } from "./enrich";
import { companyBrief, pageExtractBatch } from "./bundle";
import { landing } from "./landing";
import { openapi } from "./openapi";
import { handleMcp } from "./mcp";
import { llms } from "./llms";
import { DELIVERABLES, DELIVERABLES_BIN } from "./deliverables";

type Env = { PAY_TO: string; FACILITATOR_URL: string; NETWORK: string; DEV_FREE?: string; CDP_API_KEY_ID?: string; CDP_API_KEY_SECRET?: string };

const DEFAULTS = { PAY_TO: "0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5", NETWORK: "eip155:8453", FACILITATOR_URL: "https://facilitator.payai.network" };
const envOf = (e: any): Env => ({ ...DEFAULTS, ...(e || {}) });

const PRICES = { verify: "$0.002", preflight: "$0.005", token: "$0.003", basename: "$0.001", extract: "$0.001", enrich: "$0.002", brief: "$0.003", batch: "$0.008", wallet: "$0.002", txstatus: "$0.001" };

function routes(env: Env) {
  const accept = (price: string) => [{ scheme: "exact", price, network: env.NETWORK as `${string}:${string}`, payTo: env.PAY_TO, maxTimeoutSeconds: 120 }];
  return {
    "GET /v1/usdc-payment": {
      accepts: accept(PRICES.verify),
      description: "Verify a Base mainnet tx paid native Circle USDC to a recipient: amount, sender, confirmations, flags bridged USDbC. Use before releasing goods or marking an invoice paid.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { tx: "0x1d58cdf015648f986dadf941e30fdd4c2947862302c2bead79d58a5d8f399d20", to: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38", min: "1", minConfirmations: "3" },
        inputSchema: { properties: {
          tx: { type: "string", description: "Base mainnet transaction hash" },
          to: { type: "string", description: "Expected recipient address (optional)" },
          min: { type: "string", description: "Minimum USDC amount, decimal (optional)" },
          minConfirmations: { type: "string", description: "Required confirmations, default 1" } }, required: ["tx"] },
        output: { example: { verdict: "paid", receivedUsdc: "1.5", confirmations: 12, checks: { txSucceeded: true, nativeUsdcToRecipient: true, amountAtLeastMin: true, confirmationsAtLeast: true } } },
      } as any),
    },
    "GET /v1/x402-preflight": {
      accepts: accept(PRICES.preflight),
      description: "Preflight an x402 endpoint before paying: fetches its 402 unpaid, checks the asset is Circle-issued USDC for that network, price sanity, scheme, timeout, and payTo (contract or EOA, USDC balance on Base). Returns ok / caution / block.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { url: "https://api.onesource.io/api/chain/erc20-balance", method: "GET" },
        inputSchema: { properties: {
          url: { type: "string", description: "https URL of the x402 resource to check" },
          method: { type: "string", enum: ["GET", "POST"], description: "HTTP method, default GET" } }, required: ["url"] },
        output: { example: { verdict: "ok", httpStatus: 402, options: [{ network: "eip155:8453", assetIsCircleUsdc: true, priceUsd: 0.01, payToIsContract: false, flags: [] }] } },
      } as any),
    },
    "GET /v1/token-check": {
      accepts: accept(PRICES.token),
      description: "Base token/contract safety check before you accept, swap or approve a token: is it a contract, ERC-20 metadata, canonical official deployment (USDC, EURC, WETH, cbBTC...), impersonation of a major symbol, upgradeable proxy and admin type, owner, paused. Verdict canonical/ok/caution/block.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        inputSchema: { properties: { address: { type: "string", description: "Token or contract address on Base mainnet" } }, required: ["address"] },
        output: { example: { verdict: "canonical", isContract: true, token: { name: "USD Coin", symbol: "USDC", decimals: 6 }, canonical: { symbol: "USDC", issuer: "Circle (native)" }, proxy: { implementation: "0x...", admin: "0x...", adminIsContract: true }, flags: ["upgradeable_proxy"] } },
      } as any),
    },
    "GET /v1/wallet-snapshot": {
      accepts: accept(PRICES.wallet),
      description: "One-call Base wallet snapshot: ETH and canonical token balances (native USDC, USDbC, EURC, WETH, cbBTC, cbETH, DAI, USDT), nonce, contract-or-EOA, flags (fresh/unused address, holds bridged USDbC). Use before sending funds, accepting a counterparty, or deciding if a wallet can pay.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { address: "0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5" },
        inputSchema: { properties: { address: { type: "string", description: "Base mainnet address (EOA or contract)" } }, required: ["address"] },
        output: { example: { address: "0x...", block: 22000000, isContract: false, nonce: 12, eth: "0.0031", usdc: "25.5", tokens: { USDC: "25.5", WETH: "0.01" }, flags: [] } },
      } as any),
    },
    "GET /v1/tx-status": {
      accepts: accept(PRICES.txstatus),
      description: "Base transaction status in one call: not_found / pending / success / reverted, block, confirmations, from/to, fee in ETH (incl. L1 fee), method selector, and decoded ERC-20 Transfer events with symbols and amounts (canonical tokens flagged). Use to confirm a payment, swap or contract call landed.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { tx: "0x1d58cdf015648f986dadf941e30fdd4c2947862302c2bead79d58a5d8f399d20" },
        inputSchema: { properties: { tx: { type: "string", description: "Base mainnet transaction hash" } }, required: ["tx"] },
        output: { example: { state: "success", confirmations: 1200, feeEth: "0.0000021", tokenTransfers: [{ symbol: "USDC", canonical: true, from: "0x...", to: "0x...", amount: "1.5" }] } },
      } as any),
    },
    "GET /v1/basename": {
      accepts: accept(PRICES.basename),
      description: "Resolve a Basename (alice.base.eth) to its Base address, or an address to its primary Basename with forward-verification (reverse record must resolve back). Use before sending funds to a name.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { name: "jesse.base.eth" },
        inputSchema: { properties: { name: { type: "string", description: "Basename, e.g. alice or alice.base.eth" }, address: { type: "string", description: "0x address for reverse lookup (instead of name)" } } },
        output: { example: { name: "jesse.base.eth", address: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9", found: true } },
      } as any),
    },
    "GET /v1/page-extract": {
      accepts: accept(PRICES.extract),
      description: "Web page to clean Markdown plus metadata: fetch any public URL and return the main content as Markdown (Readability), title, description, canonical, language, author, publish/modified dates, OpenGraph and Twitter card fields, JSON-LD types, headings outline, favicon, feeds, link counts (optional link list), word count. Honours robots.txt; errors (blocked, 4xx/5xx upstream, non-HTML) are not charged.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { url: "https://blog.cloudflare.com/", maxChars: "20000", links: "0" },
        inputSchema: { properties: {
          url: { type: "string", description: "Public http(s) URL of the page to extract" },
          maxChars: { type: "string", description: "Max Markdown characters returned (500-100000, default 20000)" },
          links: { type: "string", enum: ["0", "1"], description: "1 = include up to 150 absolute links with anchor text" } }, required: ["url"] },
        output: { example: { finalUrl: "https://blog.cloudflare.com/", title: "Cloudflare Blog", description: "Technical deep dives...", canonical: "https://blog.cloudflare.com/", lang: "en-us", image: "https://.../og.png", og: { title: "Cloudflare Blog", type: "website" }, headings: [{ level: 1, text: "Cloudflare Blog" }], links: { total: 120, internal: 90, external: 30 }, markdown: "November 9, 2026 [Launching the Vite Ecosystem Fund](https://...)...", wordCount: 365, readingTimeMin: 2, truncated: false } },
      } as any),
    },
    "GET /v1/domain-enrich": {
      accepts: accept(PRICES.enrich),
      description: "Company/domain enrichment from public sources for a domain, URL or work email: company name, description, logo, address, social profiles (LinkedIn, X, GitHub...), contact emails/phones from the homepage; email provider from MX (Google Workspace, Microsoft 365...), SPF/DMARC policy; DNS host/provider, SaaS signals from TXT verifications (Stripe, HubSpot, OpenAI...); RDAP registration (registrar, created, age, expiry); website tech stack (CMS, framework, CDN, analytics, chat). Unknown domain = 422, not charged.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { domain: "stripe.com" },
        inputSchema: { properties: {
          domain: { type: "string", description: "Domain (stripe.com), URL, or work email (jane@stripe.com)" },
          site: { type: "string", enum: ["0", "1"], description: "0 = skip homepage fetch (DNS + RDAP only, faster)" } }, required: ["domain"] },
        output: { example: { domain: "stripe.com", company: { name: "Stripe", description: "Stripe is a financial services platform...", socials: { linkedin: "https://www.linkedin.com/company/stripe/", x: "https://twitter.com/stripe", github: "https://github.com/stripe" } }, email: { provider: "Google Workspace", dmarcPolicy: "reject" }, dns: { dnsProvider: "Amazon Route 53" }, registration: { registrar: "SafeNames Ltd.", created: "1995-09-12T04:00:00Z", ageDays: 11384 }, techStack: [{ name: "Next.js", category: "Framework" }], saasSignals: ["Google Search Console", "OpenAI", "Atlassian"] } },
      } as any),
    },
    "GET /v1/company-brief": {
      accepts: accept(PRICES.brief),
      description: "Company brief bundle: everything in domain-enrich (name, socials, email provider, SPF/DMARC, DNS provider, RDAP age, tech stack, SaaS signals) plus the homepage and About page as clean Markdown, in one call. Unknown domain = 422, not charged.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { domain: "basecamp.com", maxChars: "6000" },
        inputSchema: { properties: { domain: { type: "string", description: "Domain, URL or work email" }, maxChars: { type: "string", description: "Max Markdown chars per page (500-20000, default 6000)" } }, required: ["domain"] },
        output: { example: { domain: "basecamp.com", company: { name: "Basecamp" }, email: { provider: "Self-hosted" }, techStack: [{ name: "Cloudflare", category: "CDN" }], homepage: { url: "https://basecamp.com/", title: "Basecamp", markdown: "...", wordCount: 744 }, aboutPage: { url: "https://basecamp.com/about", markdown: "..." } } },
      } as any),
    },
    "GET /v1/page-extract-batch": {
      accepts: accept(PRICES.batch),
      description: "Batch web page to Markdown + metadata for up to 10 URLs in parallel (flat $0.008 = $0.0008/URL at 10). Per-URL errors are reported inline; if no URL succeeds the call returns 422 and is not charged.",
      mimeType: "application/json",
      extensions: declareDiscoveryExtension({
        input: { urls: "https://x402.org/,https://example.com/", maxChars: "8000" },
        inputSchema: { properties: { urls: { type: "string", description: "Comma-separated public URLs (max 10); or repeat url=" }, maxChars: { type: "string", description: "Max Markdown chars per page (500-30000, default 8000)" }, links: { type: "string", enum: ["0", "1"], description: "1 = include links per page" } }, required: ["urls"] },
        output: { example: { count: 2, ok: 2, failed: 0, results: [{ ok: true, finalUrl: "https://x402.org/", title: "x402", markdown: "...", wordCount: 420 }] } },
      } as any),
    },
  };
}

// Built per request (cheap); /supported is cached as resolved data in CachedFacilitatorClient.
function middleware(env: Env) {
  // CDP facilitator (needed for CDP Bazaar indexing) when secrets are set; otherwise a public no-key facilitator.
  const fc = env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET
    ? new CachedFacilitatorClient(createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET) as any)
    : new CachedFacilitatorClient({ url: env.FACILITATOR_URL });
  const server = new x402ResourceServer(fc)
    .register(env.NETWORK as `${string}:${string}`, new ExactEvmScheme());
  server.registerExtension(bazaarResourceServerExtension);
  return paymentMiddleware(routes(env) as any, server);
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", async (c, next) => { c.env = envOf(c.env) as any; const h = c.req.raw.headers; console.log(JSON.stringify({ ua: (h.get("user-agent") || "").slice(0, 120), pay: !!(h.get("payment-signature") || h.get("x-payment")), ref: (h.get("referer") || "").slice(0, 100) })); await next(); });

const info = (env: Env) => ({
  name: "ZERO Payment Guard",
  operator: "ZERO, an AI agent operated by Silas Montgomery (xge9m3ex@mail.grokbot.com)",
  payment: { protocol: "x402 v2", scheme: "exact", network: env.NETWORK, asset: "USDC (Circle native)", payTo: env.PAY_TO, facilitator: env.CDP_API_KEY_ID ? "CDP" : env.FACILITATOR_URL },
  endpoints: [
    { path: "/v1/usdc-payment?tx=&to=&min=&minConfirmations=", price: PRICES.verify, what: "Did this Base tx pay native USDC to me?" },
    { path: "/v1/x402-preflight?url=&method=", price: PRICES.preflight, what: "Is this x402 endpoint's payment request safe to sign?" },
    { path: "/v1/token-check?address=", price: PRICES.token, what: "Is this Base token canonical or suspicious?" },
    { path: "/v1/basename?name=|address=", price: PRICES.basename, what: "Basename forward/reverse resolution" },
    { path: "/v1/wallet-snapshot?address=", price: PRICES.wallet, what: "Base wallet: ETH + canonical token balances, nonce, EOA/contract, flags" },
    { path: "/v1/tx-status?tx=", price: PRICES.txstatus, what: "Base tx: state, confirmations, fee, decoded ERC-20 transfers" },
    { path: "/v1/company-brief?domain=", price: PRICES.brief, what: "Bundle: domain-enrich + homepage/About Markdown" },
    { path: "/v1/page-extract-batch?urls=", price: PRICES.batch, what: "Page extract for up to 10 URLs" },
    { path: "/v1/domain-enrich?domain=", price: PRICES.enrich, what: "Company/domain enrichment: socials, email provider, DNS/RDAP, tech stack" },
    { path: "/v1/page-extract?url=&maxChars=&links=", price: PRICES.extract, what: "Web page to clean Markdown + metadata (OG, JSON-LD, headings, links)" },
  ],
  free: ["/", "/health", "/openapi.json", "/.well-known/x402", "/sample/usdc-payment", "/sample/x402-preflight", "/sample/token-check", "/sample/basename", "/sample/page-extract", "/sample/domain-enrich", "/sample/company-brief", "/sample/page-extract-batch", "/sample/wallet-snapshot", "/sample/tx-status", "/mcp", "/llms.txt"],
});

app.get("/", c => (/text\/html/.test(c.req.header("accept") || "") ? c.html(landing(new URL(c.req.url).origin, c.env.PAY_TO)) : c.json(info(c.env))));
app.get("/health", c => c.json({ ok: true }));
app.get("/openapi.json", c => c.json(openapi(new URL(c.req.url).origin)));
// Directory probes send HEAD: answer with the same 402 challenge as an unpaid GET, never run the handler.
app.on("HEAD", "/v1/*", async c => {
  const r = await app.fetch(new Request(c.req.url, { method: "GET" }), c.env, c.executionCtx);
  return new Response(null, { status: r.status, headers: r.headers });
});
// Directory probes may POST {}: an unpaid POST gets the same 402 challenge as an unpaid GET (paid calls use GET).
app.post("/v1/*", async c => {
  const h = c.req.raw.headers;
  if (h.get("payment-signature") || h.get("x-payment")) return c.json({ error: "Paid calls use GET with query parameters; see /openapi.json" }, 405);
  const r = await app.fetch(new Request(c.req.url, { method: "GET", headers: { accept: h.get("accept") || "application/json" } }), c.env, c.executionCtx);
  return new Response(r.body, { status: r.status, headers: r.headers });
});
app.get("/.well-known/402index-verify.txt", c => c.text("ab5a5c97c8d97355f22f8f8f13276f30961c7c11383edaab37318e137028258a"));

app.get("/.well-known/mcp-registry-auth", c => c.text("v=MCPv1; k=ed25519; p=5GO++eh+11X/fDD2tfNII6vcXLkLkVEXAocUCBGgf9s="));
app.get("/d/:name", c => { const b = DELIVERABLES_BIN[c.req.param("name")]; if (b) { const bytes = Uint8Array.from(atob(b), ch => ch.charCodeAt(0)); return c.body(bytes, 200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${c.req.param("name")}"` }); } const v = DELIVERABLES[c.req.param("name")]; return v ? c.body(v, 200, { "content-type": c.req.param("name").endsWith(".csv") ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" }) : c.json({ error: "not found" }, 404); });
app.get("/llms.txt", c => c.text(llms(new URL(c.req.url).origin)));
app.get("/.well-known/ai-plugin.json", c => { const o = new URL(c.req.url).origin; return c.json({ schema_version: "v1", name_for_human: "ZERO Payment Guard", name_for_model: "zero_payment_guard", description_for_human: "Check an x402 payment request or a Base USDC payment before trusting it.", description_for_model: "Before paying an x402 endpoint call /v1/x402-preflight?url=...; to confirm a Base USDC payment call /v1/usdc-payment?tx=...&to=...&min=... . Paid per call via x402 (USDC on Base).", auth: { type: "none" }, api: { type: "openapi", url: o + "/openapi.json" }, contact_email: "xge9m3ex@mail.grokbot.com", legal_info_url: o + "/" }); });
app.get("/.well-known/mcp.json", c => { const o = new URL(c.req.url).origin; return c.json({ name: "zero-payment-guard", description: "x402 preflight and Base USDC payment verification (paid tools via x402-over-MCP)", transport: "streamable-http", url: o + "/mcp", tools: ["domain_enrich", "company_brief", "page_extract_batch", "page_extract", "x402_preflight", "usdc_payment_check", "token_check", "basename_resolve", "wallet_snapshot", "tx_status", "sample_report"] }); });
app.get("/.well-known/agent-card.json", c => { const o = new URL(c.req.url).origin; return c.json({ protocolVersion: "0.3.0", name: "ZERO Payment Guard", description: "Read-only payment safety checks for agents on Base: x402 endpoint preflight and native-USDC payment verification. Paid per call via x402.", url: o + "/mcp", version: "1.0.0", provider: { organization: "ZERO (AI agent operated by Silas Montgomery)", url: o + "/" }, supportedInterfaces: [{ url: o + "/mcp", protocolBinding: "MCP", protocolVersion: "2025-06-18" }], capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], skills: [{ id: "company_brief", name: "Company brief (bundle)", description: "domain-enrich + homepage and About page as Markdown in one call. $0.003.", tags: ["enrichment", "company", "research"] }, { id: "page_extract_batch", name: "Batch page extract", description: "Up to 10 URLs to Markdown + metadata. $0.008 flat.", tags: ["web", "scrape", "markdown", "batch"] }, { id: "domain_enrich", name: "Company/domain enrichment", description: "Domain or work email to company profile: socials, email provider (MX), SPF/DMARC, DNS provider, RDAP registration, tech stack, SaaS signals. $0.002.", tags: ["enrichment", "company", "domain", "dns", "whois", "tech-stack"] }, { id: "page_extract", name: "Web page to Markdown + metadata", description: "Fetch a public URL and return clean Markdown plus title, description, OpenGraph, JSON-LD, headings, links. $0.001.", tags: ["web", "scrape", "markdown", "metadata", "og"] }, { id: "x402_preflight", name: "x402 preflight", description: "Check an x402 payment request (asset, price, scheme, timeout, payTo) before paying. $0.005.", tags: ["x402", "usdc", "base", "safety"] }, { id: "usdc_payment_check", name: "USDC payment verification", description: "Verify a Base tx paid native Circle USDC to a recipient. $0.002.", tags: ["usdc", "base", "verification"] }] }); });

app.all("/mcp", c => handleMcp(c.req.raw, c.env));

app.get("/.well-known/ai.txt", c => c.text(`x402-endpoint: ${new URL(c.req.url).origin}/v1\nx402-network: base\nx402-asset: USDC\nx402-price: 0.002\ncontact: xge9m3ex@mail.grokbot.com\n`));
app.get("/x402.json", c => { const o = new URL(c.req.url).origin; return c.json({ name: "ZERO Payment Guard", network: "base", asset: "USDC", payTo: c.env.PAY_TO, endpoints: [{ url: `${o}/v1/usdc-payment`, method: "GET", price: "0.002" }, { url: `${o}/v1/x402-preflight`, method: "GET", price: "0.005" }, { url: `${o}/v1/token-check`, method: "GET", price: "0.003" }, { url: `${o}/v1/basename`, method: "GET", price: "0.001" }, { url: `${o}/v1/page-extract`, method: "GET", price: "0.001" }, { url: `${o}/v1/domain-enrich`, method: "GET", price: "0.002" }, { url: `${o}/v1/company-brief`, method: "GET", price: "0.003" }, { url: `${o}/v1/page-extract-batch`, method: "GET", price: "0.008" }, { url: `${o}/v1/wallet-snapshot`, method: "GET", price: "0.002" }, { url: `${o}/v1/tx-status`, method: "GET", price: "0.001" }], samples: [`${o}/sample/usdc-payment`, `${o}/sample/x402-preflight`] }); });

app.get("/.well-known/x402", c => {
  const origin = new URL(c.req.url).origin;
  return c.json({ version: 1, resources: [`${origin}/v1/usdc-payment`, `${origin}/v1/x402-preflight`, `${origin}/v1/token-check`, `${origin}/v1/basename`, `${origin}/v1/page-extract`, `${origin}/v1/domain-enrich`, `${origin}/v1/company-brief`, `${origin}/v1/page-extract-batch`, `${origin}/v1/wallet-snapshot`, `${origin}/v1/tx-status`], ownershipProofs: origin === "https://zero-payment-guard.worker.beacon.host" ? ["0x17df864489eebf792d4885a09bbd264ebe414c0d719a052306200532498e0b8e63834af70fc11cfda82983709b8159725b23a9c422b7a9ba79f79751ed41d0441c"] : [], instructions: "Pay per call with x402 v2, USDC on Base." });
});

// Payment gate (DEV_FREE=1 only in local `wrangler dev --var DEV_FREE:1` testing; never set in production)
app.use("/v1/*", async (c, next) => {
  if (c.env.DEV_FREE === "1") return next();
  const ret = await middleware(c.env)(c, next);
  if (ret instanceof Response) c.res = ret;
  // Mirror the v2 PAYMENT-REQUIRED header into the 402 body so v1-style scanners (which read `accepts` from the body) can index us.
  const pr = c.res.status === 402 ? c.res.headers.get("PAYMENT-REQUIRED") : null;
  if (pr) {
    try {
      const body = JSON.parse(atob(pr));
      const h = new Headers(c.res.headers); h.set("content-type", "application/json");
      c.res = new Response(JSON.stringify(body), { status: 402, headers: h });
    } catch {}
  }
  return c.res;
});

// With no inputs, the paid routes run a real check on a fixed sample (so a no-argument test buy still gets real product).
const SAMPLE_PAYMENT = { tx: "0x1d58cdf015648f986dadf941e30fdd4c2947862302c2bead79d58a5d8f399d20", to: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38", min: "1", minConfirmations: "3" };
const SAMPLE_PREFLIGHT = { url: "https://api.onesource.io/api/chain/erc20-balance", method: "GET" };
const payQ = (q: Record<string, string>) => (q.tx ? q : { ...SAMPLE_PAYMENT, ...q });
const preQ = (q: Record<string, string>) => (q.url ? q : { ...SAMPLE_PREFLIGHT, ...q });
const withSample = (body: any, sampled: boolean) => (sampled ? { sample: true, sampleNote: "No input given: this is a real live check on a fixed sample. Pass your own parameters to check yours.", ...body } : body);
app.get("/v1/usdc-payment", async c => { const q = c.req.query(); const r = await verifyUsdcPayment(payQ(q)); return c.json(withSample(r.body, !q.tx), r.status as any); });
app.get("/v1/x402-preflight", async c => { const q = c.req.query(); const r = await preflightX402(preQ(q)); return c.json(withSample(r.body, !q.url), r.status as any); });
const SAMPLE_TOKEN = { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };
const SAMPLE_NAME = { name: "jesse.base.eth" };
app.get("/v1/token-check", async c => { const q = c.req.query(); const r = await tokenCheck(q.address ? q : SAMPLE_TOKEN); return c.json(withSample(r.body, !q.address), r.status as any); });
app.get("/v1/basename", async c => { const q = c.req.query(); const has = !!(q.name || q.address); const r = await basename(has ? q : SAMPLE_NAME); return c.json(withSample(r.body, !has), r.status as any); });
const SAMPLE_BRIEF = { domain: "basecamp.com", maxChars: "3000" };
const SAMPLE_BATCH = { urls: "https://x402.org/,https://example.com/", maxChars: "1500" };
app.get("/v1/company-brief", async c => { const q = c.req.query(); const has = !!(q.domain || q.email || q.url); const r = await companyBrief(has ? q : SAMPLE_BRIEF); return c.json(withSample(r.body, !has), r.status as any); });
app.get("/v1/page-extract-batch", async c => { const q = c.req.query(); const all = c.req.queries() || {}; const has = !!(q.urls || (all.url || []).length); const r = await pageExtractBatch(has ? q : SAMPLE_BATCH, has ? all : {}); return c.json(withSample(r.body, !has), r.status as any); });
app.get("/sample/company-brief", async c => { const r = await companyBrief(SAMPLE_BRIEF); return c.json(withSample(r.body, true), r.status as any); });
app.get("/sample/page-extract-batch", async c => { const r = await pageExtractBatch(SAMPLE_BATCH, {}); return c.json(withSample(r.body, true), r.status as any); });
const SAMPLE_DOMAIN = { domain: "stripe.com" };
app.get("/v1/domain-enrich", async c => { const q = c.req.query(); const has = !!(q.domain || q.email || q.url); const r = await domainEnrich(has ? q : SAMPLE_DOMAIN); return c.json(withSample(r.body, !has), r.status as any); });
app.get("/sample/domain-enrich", async c => { const r = await domainEnrich(SAMPLE_DOMAIN); return c.json(withSample(r.body, true), r.status as any); });
const SAMPLE_PAGE = { url: "https://blog.cloudflare.com/", maxChars: "4000" };
app.get("/v1/page-extract", async c => { const q = c.req.query(); const r = await pageExtract(q.url ? q : SAMPLE_PAGE); return c.json(withSample(r.body, !q.url), r.status as any); });
app.get("/sample/page-extract", async c => { const r = await pageExtract(SAMPLE_PAGE); return c.json(withSample(r.body, true), r.status as any); });
app.get("/sample/token-check", async c => { const r = await tokenCheck(SAMPLE_TOKEN); return c.json(withSample(r.body, true), r.status as any); });
app.get("/sample/basename", async c => { const r = await basename(SAMPLE_NAME); return c.json(withSample(r.body, true), r.status as any); });
// Free samples: same shape as the paid routes, real data, fixed inputs.
app.get("/sample/usdc-payment", async c => { const r = await verifyUsdcPayment(SAMPLE_PAYMENT); return c.json(withSample(r.body, true), r.status as any); });
app.get("/sample/x402-preflight", async c => { const r = await preflightX402(SAMPLE_PREFLIGHT); return c.json(withSample(r.body, true), r.status as any); });

const SAMPLE_WALLET = { address: "0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5" };
const SAMPLE_TX = { tx: "0x1d58cdf015648f986dadf941e30fdd4c2947862302c2bead79d58a5d8f399d20" };
app.get("/v1/wallet-snapshot", async c => { const q = c.req.query(); const r = await walletSnapshot(q.address ? q : SAMPLE_WALLET); return c.json(withSample(r.body, !q.address), r.status as any); });
app.get("/v1/tx-status", async c => { const q = c.req.query(); const r = await txStatus(q.tx ? q : SAMPLE_TX); return c.json(withSample(r.body, !q.tx), r.status as any); });
app.get("/sample/wallet-snapshot", async c => { const r = await walletSnapshot(SAMPLE_WALLET); return c.json(withSample(r.body, true), r.status as any); });
app.get("/sample/tx-status", async c => { const r = await txStatus(SAMPLE_TX); return c.json(withSample(r.body, true), r.status as any); });

app.onError((e, c) => c.json({ error: "internal", detail: String(e).slice(0, 300) }, 500));

export default app;
