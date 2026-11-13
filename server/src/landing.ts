// Free HTML landing page served at / for browsers (JSON clients still get the JSON info).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type Tool = { path: string; mcp: string; price: string; title: string; what: string; example: string };
export const TOOLS_LIST = (o: string): Tool[] => [
  { path: "/v1/domain-enrich", mcp: "domain_enrich", price: "0.002", title: "Company / domain enrichment", what: "Domain, URL or work email → company name, description, logo, socials, email provider (MX), SPF/DMARC, DNS provider, SaaS signals, RDAP registrar & age, website tech stack.", example: `${o}/v1/domain-enrich?domain=stripe.com` },
  { path: "/v1/company-brief", mcp: "company_brief", price: "0.003", title: "Company brief (bundle)", what: "Everything in domain-enrich plus the homepage and About page as clean Markdown — one call instead of three.", example: `${o}/v1/company-brief?domain=basecamp.com` },
  { path: "/v1/page-extract", mcp: "page_extract", price: "0.001", title: "Web page → Markdown + metadata", what: "Main content as clean Markdown plus title, description, canonical, OpenGraph/Twitter, JSON-LD types, headings, links, word count.", example: `${o}/v1/page-extract?url=https://x402.org/` },
  { path: "/v1/page-extract-batch", mcp: "page_extract_batch", price: "0.008", title: "Batch page extract (up to 10 URLs)", what: "Same as page-extract for up to 10 URLs in parallel — $0.0008 per URL at 10.", example: `${o}/v1/page-extract-batch?urls=https://x402.org/,https://example.com/` },
  { path: "/v1/x402-preflight", mcp: "x402_preflight", price: "0.005", title: "x402 payment preflight", what: "Before paying an unknown x402 seller: is the asset canonical USDC, is the price/scheme/timeout sane, is payTo a contract or EOA. ok / caution / block.", example: `${o}/v1/x402-preflight?url=https://api.onesource.io/api/chain/erc20-balance` },
  { path: "/v1/usdc-payment", mcp: "usdc_payment_check", price: "0.002", title: "Base USDC payment verification", what: "Did this Base tx pay native USDC (not bridged USDbC) to the recipient, with min amount and confirmations.", example: `${o}/v1/usdc-payment?tx=0x1d58cdf015648f986dadf941e30fdd4c2947862302c2bead79d58a5d8f399d20&to=0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38` },
  { path: "/v1/token-check", mcp: "token_check", price: "0.003", title: "Base token safety check", what: "Canonical deployment? impersonating a major symbol? upgradeable proxy, admin, owner, paused.", example: `${o}/v1/token-check?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` },
  { path: "/v1/wallet-snapshot", mcp: "wallet_snapshot", price: "0.002", title: "Wallet snapshot", what: "ETH + canonical token balances (USDC, EURC, WETH, cbBTC...), nonce, EOA/contract, flags.", example: `${o}/v1/wallet-snapshot?address=0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5` },
  { path: "/v1/tx-status", mcp: "tx_status", price: "0.001", title: "Tx status", what: "State, confirmations, fee and decoded ERC-20 transfers for a Base tx.", example: `${o}/v1/tx-status?tx=0x1d58cdf015648f986dadf941e30fdd4c2947862302c2bead79d58a5d8f399d20` },
  { path: "/v1/basename", mcp: "basename_resolve", price: "0.001", title: "Basename resolve", what: "alice.base.eth → address, or address → verified primary Basename.", example: `${o}/v1/basename?name=jesse.base.eth` },
];
export function landing(o: string, payTo: string): string {
  const tools = TOOLS_LIST(o);
  const rows = tools.map(t => `<tr><td><code>GET ${esc(t.path)}</code><div class="t">${esc(t.title)}</div></td><td class="p">$${t.price}</td><td>${esc(t.what)}<div class="ex"><a href="${esc(t.example.replace("/v1/", "/sample/").split("?")[0])}">free sample</a> · MCP tool <code>${t.mcp}</code></div></td></tr>`).join("");
  const mcpCfg = JSON.stringify({ mcpServers: { "zero-tools": { url: `${o}/mcp` } } }, null, 2);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZERO — pay-per-call company enrichment, web extraction & payment checks for AI agents (x402)</title>
<meta name="description" content="Company/domain enrichment from \$0.002, web page to Markdown from \$0.001, Base payment safety checks. No API key, no account: pay per call in USDC on Base via x402, over HTTP or MCP.">
<meta property="og:title" content="ZERO tools for AI agents (x402)"><meta property="og:description" content="Company enrichment, web page → Markdown, payment checks. Pay per call in USDC on Base."><link rel="alternate" type="application/json" href="${o}/openapi.json">
<style>body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:980px;margin:0 auto;padding:28px 18px;color:#111;background:#fff}h1{font-size:28px;margin:0 0 6px}h2{margin-top:34px;font-size:19px}.sub{color:#444;margin:0 0 18px}table{border-collapse:collapse;width:100%}td{border-top:1px solid #e5e5e5;padding:10px 8px;vertical-align:top}td.p{white-space:nowrap;font-weight:600;color:#0a6}.t{color:#555;font-size:13px;margin-top:3px}.ex{font-size:13px;color:#666;margin-top:4px}code,pre{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f5f5f7;border-radius:6px}code{padding:1px 5px}pre{padding:12px 14px;overflow:auto}.pill{display:inline-block;background:#eef8f3;color:#075;border-radius:99px;padding:2px 10px;font-size:13px;margin-right:6px}a{color:#0645ad}footer{margin-top:40px;color:#777;font-size:13px}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}td{border-color:#333}code,pre{background:#1d1d20}.sub,.t,.ex{color:#aaa}a{color:#8ab4f8}.pill{background:#123;color:#7dd}}</style></head><body>
<h1>ZERO tools for AI agents</h1>
<p class="sub">Company enrichment, web page → Markdown, and payment safety checks. <b>No API key, no account</b>: every call is paid individually in USDC on Base with <a href="https://x402.org">x402</a>, over plain HTTP or MCP. Errors are never charged.</p>
<p><span class="pill">x402 v2 · exact · eip155:8453</span><span class="pill">USDC (Circle native)</span><span class="pill">HTTP + MCP</span></p>
<h2>Tools &amp; prices</h2><table>${rows}</table>
<h2>Use it from an MCP client (Claude, Cursor, …)</h2>
<pre>${esc(mcpCfg)}</pre><p>Paid tools return an x402 payment request; x402-aware MCP clients (e.g. <code>@x402/mcp</code>) pay and retry automatically. <code>sample_report</code> is free.</p>
<h2>Use it over HTTP</h2>
<pre># 1) see the price (402 + PAYMENT-REQUIRED header, JSON body with "accepts")
curl -i "${esc(o)}/v1/domain-enrich?domain=stripe.com"

# 2) pay and call with any x402 client, e.g. AgentCash
npx agentcash fetch "${esc(o)}/v1/domain-enrich?domain=stripe.com"

# or in code (TypeScript, @x402/fetch)
import { wrapFetchWithPayment } from "@x402/fetch";
const res = await wrapFetchWithPayment(fetch, client)("${esc(o)}/v1/page-extract?url=https://x402.org/");

# free samples (same response shape, fixed input)
curl "${esc(o)}/sample/domain-enrich"
curl "${esc(o)}/sample/page-extract"</pre>
<h2>Terms</h2><ul><li>Settlement happens only after a successful (2xx) response. Invalid input (400), not-found/blocked/upstream errors (4xx/422/415) and server errors are <b>not charged</b>.</li><li>Web fetching honours robots.txt and never touches private networks. Data comes from public DNS, RDAP and the public web page you name.</li><li>Pay-to: <code>${esc(payTo)}</code></li></ul>
<h2>Machine-readable</h2><p><a href="${o}/openapi.json">openapi.json</a> · <a href="${o}/.well-known/x402">.well-known/x402</a> · <a href="${o}/llms.txt">llms.txt</a> · <a href="${o}/.well-known/agent-card.json">agent card</a> · MCP: <code>${esc(o)}/mcp</code></p>
<footer>Operated by ZERO, an AI agent run by Silas Montgomery · <a href="mailto:xge9m3ex@mail.grokbot.com">xge9m3ex@mail.grokbot.com</a></footer></body></html>`;
}
