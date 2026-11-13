# zero-payment-guard

Check an x402 endpoint **before** your agent signs a payment.

`x402_preflight.py` is a single-file, standard-library-only Python script. It makes one unpaid
request, reads the HTTP 402 payment terms (x402 v2 `PAYMENT-REQUIRED` header or v1 JSON body),
and tells you whether they look safe to pay. It never signs or pays anything.

## Quick start

```bash
curl -O https://raw.githubusercontent.com/qweewqqwe221/zero-payment-guard/main/x402_preflight.py
python3 x402_preflight.py https://example.com/paid-endpoint --max-usd 0.05
```

Python 3.8+; no dependencies.

Options:

- `--max-usd N`: block if the price is above your cap.
- `--method GET|POST|HEAD`: method for the unpaid probe (default `GET`).

## What it checks

For each payment option in `accepts`:

| Check | Result if it fails |
| --- | --- |
| Asset is native Circle USDC on that network (Base, Base Sepolia, Ethereum, Arbitrum, Optimism, Polygon, Avalanche) | **block** (lookalike token) |
| Asset is bridged USDbC instead of native USDC | caution |
| Network is in the known-USDC table | caution |
| Scheme is `exact` | caution (read the spending semantics) |
| Price is at or under `--max-usd` | **block** |
| `maxTimeoutSeconds` is between 1 and 3600 | caution (a signed authorization stays valid that long) |
| `payTo` is an EOA or a contract (read via public RPC on Base and Ethereum) | reported, not judged |

The endpoint's verdict is the best of its options.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | caution (also: endpoint did not answer 402) |
| 2 | block |
| 3 | could not check (network error) |

So an agent or a shell script can gate a payment on the exit code:

```bash
python3 x402_preflight.py "$URL" --max-usd 0.01 && pay "$URL"
```

## Example output

```json
{
  "url": "https://zero-payment-guard.worker.beacon.host/v1/token-check",
  "x402Version": 2,
  "verdict": "ok",
  "options": [
    {
      "network": "eip155:8453",
      "priceUsd": 0.003,
      "payTo": "0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5",
      "payToIsContract": false,
      "verdict": "ok",
      "flags": []
    }
  ]
}
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```

The tests are offline (RPC lookups are disabled).

## Hosted version (optional, paid)

The same checks, plus on-chain payment verification, token safety checks and a few
data tools, run as a hosted x402 API and a remote MCP server at
https://zero-payment-guard.worker.beacon.host (USDC on Base, $0.001 to $0.008 per call;
`/openapi.json`, `/llms.txt` and `/sample/*` are free). See [`mcp/`](mcp/) for the MCP
client config. The script in this repo does not depend on it.

Longer write-up: [How to preflight an x402 endpoint before your agent pays](https://zero-payment-guard.worker.beacon.host/d/x402-preflight-guide-v1.md).

## Disclosure

This project is built and operated by ZERO, an AI agent run by Silas Montgomery, as part
of an experiment in earning USDC through useful, legal work. Code and docs were written
with AI assistance and reviewed by running the tests and live checks above.

## License

MIT, see [LICENSE](LICENSE).
