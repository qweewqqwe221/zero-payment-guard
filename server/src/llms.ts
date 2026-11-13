export const llms = (o: string) => `# ZERO Payment Guard

> Cheap tools for AI agents: company/domain enrichment, web page to clean Markdown + metadata, read-only payment safety checks and cheap chain reads (wallet snapshot, tx status) on Base. Pay per call in USDC via x402 (no API key, no account).

## Paid HTTP routes (x402 v2, USDC on Base eip155:8453, payTo 0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5)
- GET ${o}/v1/company-brief?domain=<domain>&maxChars=6000 ($0.003): bundle = domain-enrich + homepage and About page as Markdown.
- GET ${o}/v1/page-extract-batch?urls=<u1>,<u2>,... ($0.008 flat, up to 10 URLs): page-extract in parallel; 422 (not charged) only if none succeed.
- GET ${o}/v1/domain-enrich?domain=<domain|url|work email>&site=0|1 ($0.002): company profile from public DNS (DoH), RDAP and the homepage: name, description, logo, socials, contact emails, email provider (MX), SPF/DMARC policy, DNS provider, SaaS signals, registrar/created/age, tech stack. Unknown domain = 422, not charged.
- GET ${o}/v1/page-extract?url=<public URL>&maxChars=20000&links=0|1 ($0.001): web page to clean Markdown (Readability) + title, description, canonical, lang, author, dates, OpenGraph/Twitter, JSON-LD types, headings, favicon, feeds, link counts. Honours robots.txt; blocked/upstream errors not charged.
- GET ${o}/v1/x402-preflight?url=<https x402 URL>&method=GET ($0.005): fetch the target's 402 unpaid; check the asset is canonical Circle USDC for that network, price/scheme/timeout sanity, payTo contract-or-EOA and USDC balance. Verdict ok/caution/block.
- GET ${o}/v1/usdc-payment?tx=<hash>&to=<addr>&min=<usdc>&minConfirmations=<n> ($0.002): did this Base tx pay native USDC (not bridged USDbC) to the recipient. Verdict paid/not_paid.
- GET ${o}/v1/token-check?address=<0x> ($0.003): Base token/contract safety: contract?, ERC-20 metadata, canonical official deployment, impersonation of a major symbol, upgradeable proxy/admin, owner, paused. Verdict canonical/ok/caution/block.
- GET ${o}/v1/wallet-snapshot?address=<0x> ($0.002): Base wallet in one call: ETH and canonical token balances (native USDC, USDbC, EURC, WETH, cbBTC, cbETH, DAI, USDT), nonce, EOA or contract, flags (fresh/unused, holds bridged USDbC).
- GET ${o}/v1/tx-status?tx=<hash> ($0.001): Base tx state not_found/pending/success/reverted, block, confirmations, from/to, fee in ETH incl. L1 fee, method selector, decoded ERC-20 Transfer events (canonical tokens flagged).
- GET ${o}/v1/basename?name=<alice.base.eth> or ?address=<0x> ($0.001): Basename forward/reverse resolution with forward-verification.
A paid call with no parameters runs a real check on a fixed sample.

## Free
- ${o}/sample/x402-preflight, ${o}/sample/usdc-payment, ${o}/sample/token-check, ${o}/sample/basename, ${o}/sample/page-extract, ${o}/sample/domain-enrich, ${o}/sample/company-brief, ${o}/sample/page-extract-batch, ${o}/sample/wallet-snapshot, ${o}/sample/tx-status (same shape as paid)
- Guide (free): ${o}/d/x402-preflight-guide-v1.md (how to preflight an x402 endpoint before paying; stdlib Python script)
- Open-source CLI (MIT, stdlib Python, never pays): https://github.com/qweewqqwe221/zero-payment-guard
- OpenAPI: ${o}/openapi.json ; x402 discovery: ${o}/.well-known/x402
- MCP (streamable HTTP; paid tools use x402-over-MCP): ${o}/mcp  tools: company_brief, page_extract_batch, domain_enrich, page_extract, x402_preflight, usdc_payment_check, token_check, basename_resolve, wallet_snapshot, tx_status, sample_report (free)

## Failure terms
Bad input returns 400 and is not charged (settlement only after a 2xx). Upstream RPC failure returns 5xx, not charged.

Contact: xge9m3ex@mail.grokbot.com (ZERO, an AI agent operated by Silas Montgomery)
`;
