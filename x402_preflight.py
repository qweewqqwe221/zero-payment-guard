#!/usr/bin/env python3
"""x402_preflight.py - check an x402 endpoint BEFORE your agent signs a payment.
Standard library only. Read-only: it never signs or pays anything.
Usage: python3 x402_preflight.py <url> [--max-usd 0.05] [--method GET]
Exit code: 0 ok, 1 caution, 2 block, 3 could not check.
"""
import base64, json, sys, urllib.request, urllib.error, argparse

# Native Circle USDC per network (CAIP-2 -> lowercase address). Anything else is not USDC.
USDC = {
    "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",   # Base
    "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",  # Base Sepolia (testnet)
    "eip155:1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",      # Ethereum
    "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",  # Arbitrum One
    "eip155:10": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",     # Optimism
    "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",    # Polygon PoS
    "eip155:43114": "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",  # Avalanche C-Chain
}
V1_NAMES = {"base": "eip155:8453", "base-sepolia": "eip155:84532", "ethereum": "eip155:1",
            "arbitrum": "eip155:42161", "optimism": "eip155:10", "polygon": "eip155:137", "avalanche": "eip155:43114"}
BRIDGED = {"0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": "USDbC (bridged, not native USDC)"}
RPC = {"eip155:8453": "https://base-rpc.publicnode.com", "eip155:1": "https://ethereum-rpc.publicnode.com"}

def fetch_402(url, method):
    req = urllib.request.Request(url, method=method, headers={"accept": "application/json", "user-agent": "x402-preflight/1"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

def parse(status, headers, body):
    h = {k.lower(): v for k, v in headers.items()}
    if "payment-required" in h:  # x402 v2: base64 JSON in a header
        return json.loads(base64.b64decode(h["payment-required"]))
    try:
        return json.loads(body)      # x402 v1: JSON body with "accepts"
    except Exception:
        return None

def rpc(net, method, params):
    if net not in RPC: return None
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC[net], data=data, headers={"content-type": "application/json", "user-agent": "x402-preflight/1"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("result")

def check_option(o, max_usd):
    flags, verdict = [], "ok"
    def bad(msg, level):
        nonlocal verdict
        flags.append(msg)
        if level == "block" or (level == "caution" and verdict == "ok"): verdict = level
    net = V1_NAMES.get(o.get("network"), o.get("network"))
    asset = (o.get("asset") or "").lower()
    amount = int(o.get("amount") or o.get("maxAmountRequired") or 0)
    if o.get("scheme") != "exact": bad(f"scheme {o.get('scheme')} (not exact): read its spending semantics", "caution")
    if net not in USDC: bad(f"network {net} not in the known-USDC table", "caution")
    elif asset in BRIDGED: bad(f"asset is {BRIDGED[asset]}", "caution")
    elif asset != USDC[net]: bad(f"asset {asset} is NOT native USDC on {net}", "block")
    usd = amount / 1e6  # USDC has 6 decimals
    if max_usd is not None and usd > max_usd: bad(f"price ${usd:g} exceeds your cap ${max_usd:g}", "block")
    t = int(o.get("maxTimeoutSeconds") or 0)
    if t <= 0 or t > 3600: bad(f"maxTimeoutSeconds={t} (signed authorization stays valid that long)", "caution")
    pay_to = o.get("payTo") or ""
    info = {"network": net, "priceUsd": usd, "payTo": pay_to}
    try:
        code = rpc(net, "eth_getCode", [pay_to, "latest"])
        if code is not None: info["payToIsContract"] = code not in ("0x", "0x0")
    except Exception as e:
        info["payToIsContract"] = f"rpc error: {e}"
    return {**info, "verdict": verdict, "flags": flags}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url"); ap.add_argument("--max-usd", type=float, default=None); ap.add_argument("--method", default="GET")
    a = ap.parse_args()
    try:
        status, headers, body = fetch_402(a.url, a.method)
    except Exception as e:  # DNS, TLS, timeout: we could not check, so do not pay
        print(json.dumps({"verdict": "unknown", "url": a.url, "flags": [f"could not fetch: {type(e).__name__}: {e}"]}, indent=2)); return 3
    if status != 402:
        print(json.dumps({"verdict": "caution", "httpStatus": status, "flags": ["did not answer 402 unpaid"]}, indent=2)); return 1
    try:
        pr = parse(status, headers, body)
    except Exception:
        pr = None
    if not pr or not pr.get("accepts"):
        print(json.dumps({"verdict": "block", "httpStatus": 402, "flags": ["402 without a readable accepts list"]}, indent=2)); return 2
    opts = [check_option(o, a.max_usd) for o in pr["accepts"]]
    rank = {"ok": 0, "caution": 1, "block": 2}
    best = min(opts, key=lambda o: rank[o["verdict"]])
    out = {"url": a.url, "x402Version": pr.get("x402Version"), "description": (pr.get("resource") or {}).get("description"),
           "verdict": best["verdict"], "options": opts}
    print(json.dumps(out, indent=2))
    return rank[best["verdict"]]

if __name__ == "__main__":
    sys.exit(main())
