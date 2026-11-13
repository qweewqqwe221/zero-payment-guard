# ZERO Payment Guard: server

This is the source of the hosted x402 API and MCP server at https://zero-payment-guard.worker.beacon.host.
It is a [Hono](https://hono.dev) app that runs on Cloudflare-Workers-compatible runtimes and on Node.

## What it exposes

| Surface | Path | Notes |
| --- | --- | --- |
| Paid HTTP API (x402 v2, USDC on Base) | `GET /v1/*` | x402-preflight, usdc-payment, token-check, wallet-snapshot, tx-status, basename, page-extract, page-extract-batch, domain-enrich, company-brief |
| MCP, streamable HTTP | `POST /mcp` | 10 paid tools + free `sample_report`; payments use x402-over-MCP (`@x402/mcp`) |
| MCP, stdio | `npm run stdio` | same tools, for local clients and directory introspection |
| Free discovery | `/openapi.json`, `/llms.txt`, `/.well-known/x402`, `/sample/*` | |

Every handler is read-only: public Base RPC reads, public DNS/RDAP, and fetching public web pages on request (it honours robots.txt and blocks private hosts). The server holds no private keys. It only names a `PAY_TO` address that receives payments, and the facilitator settles them.

## Run locally

```bash
cd server
npm ci
npm start                 # HTTP on 127.0.0.1:8790 (PORT to change)
npm run stdio             # MCP over stdio
```

MCP client config for the stdio server:

```json
{
  "mcpServers": {
    "zero-payment-guard": { "command": "npx", "args": ["tsx", "/path/to/zero-payment-guard/server/src/stdio.ts"] }
  }
}
```

Or with Docker, from the repo root: `docker build -t zero-payment-guard . && docker run -i --rm zero-payment-guard`.

## Configuration

Set these in `wrangler.toml` `[vars]` or as environment variables. They are not secrets.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PAY_TO` | operator wallet | address that receives USDC; **change it to your own** if you deploy a copy |
| `NETWORK` | `eip155:8453` | Base mainnet |
| `FACILITATOR_URL` | `https://facilitator.payai.network` | x402 facilitator (no key needed) |

Optional secrets, set with `wrangler secret put` and never committed: `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` switch to the Coinbase CDP facilitator. `DEV_FREE=1` (local testing only) disables the paywall.

## Deploy

`npx wrangler deploy` (Cloudflare) or any Workers-compatible host. The hosted copy runs on beacon.host.

## Layout

- `src/index.ts`: routes, paywall (`@x402/hono`), discovery documents
- `src/mcp.ts`: MCP server (`buildMcp`) and the streamable-HTTP handler
- `src/stdio.ts`: stdio entrypoint; `src/node.ts`: Node HTTP entrypoint
- `src/checks*.ts`: Base payment, token, wallet and tx checks
- `src/extract.ts`, `src/enrich.ts`, `src/bundle.ts`: web page extraction and company enrichment
- `src/fac.ts`: facilitator client that caches `/supported` as data (safe on Workers)
