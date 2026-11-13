// Pure check logic for ZERO Payment Guard (no payment code here).
export const BASE_RPCS = ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org", "https://1rpc.io/base", "https://base.llamarpc.com"];
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDBC_BASE = "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca"; // bridged USDbC, NOT native USDC
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Circle-issued native USDC by CAIP-2 network, from https://developers.circle.com/stablecoins/usdc-contract-addresses (checked 2026-11-12)
export const CANONICAL_USDC: Record<string, string> = {
  "eip155:8453": USDC_BASE,
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "eip155:1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "eip155:10": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  "eip155:43114": "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
  "eip155:130": "0x078d782b760474a361dda0af3839290b0ef57ad6",
  "eip155:59144": "0x176211869ca2b568f2a7d4ee941e073a821ee1ff",
  "eip155:480": "0x79a02482a880bce3f13e09da970dc34db4cd24d1",
  "eip155:146": "0x29219dd400f2bf60e5a23d13be72b486d4038894",
  "eip155:324": "0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4",
  "eip155:42220": "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
  "eip155:57073": "0x2d270e6886d130d724215a266106e6832161eaed",
  "eip155:143": "0x754704bc059f8c67012fed69bc8a327a5aafb603",
  "eip155:999": "0xb88339cb7199b77e23db6e890353e22632ba630f",
  "eip155:1329": "0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
// x402 v1 network names -> CAIP-2
const V1_NETWORKS: Record<string, string> = {
  base: "eip155:8453", "base-sepolia": "eip155:84532", ethereum: "eip155:1", arbitrum: "eip155:42161",
  optimism: "eip155:10", polygon: "eip155:137", avalanche: "eip155:43114", sei: "eip155:1329",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isTx = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

export async function rpc(method: string, params: unknown[]): Promise<any> {
  let last: unknown;
  for (const url of BASE_RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j: any = await r.json();
      if (j.error) throw new Error(j.error.message);
      if (!("result" in j)) throw new Error("no result");
      if (j.result === null && method !== "eth_getTransactionReceipt") throw new Error("null result");
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error("Base RPC unavailable: " + String(last));
}

const fmt6 = (v: bigint) => { const s = v.toString().padStart(7, "0"); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, "") || "0"; };

/** Verify that a Base tx delivered native USDC to `to` (optionally at least `min` USDC). */
export async function verifyUsdcPayment(q: { tx?: string; to?: string; min?: string; minConfirmations?: string }) {
  const tx = (q.tx || "").trim(); const to = (q.to || "").trim().toLowerCase();
  if (!isTx(tx)) return { status: 400, body: { error: "tx must be a 0x-prefixed 32-byte hash" } };
  if (to && !isAddr(to)) return { status: 400, body: { error: "to must be a 0x address" } };
  const minUnits = q.min ? BigInt(Math.round(Number(q.min) * 1e6)) : 0n;
  const needConf = Math.max(0, Math.min(1000, Number(q.minConfirmations || 1) || 1));
  const [receipt, head] = await Promise.all([rpc("eth_getTransactionReceipt", [tx]), rpc("eth_blockNumber", [])]);
  if (!receipt) return { status: 200, body: { tx, found: false, verdict: "not_found", note: "Not mined on Base mainnet (or wrong chain)." } };
  const confirmations = Number(BigInt(head) - BigInt(receipt.blockNumber)) + 1;
  const transfers: any[] = []; let bridged = 0;
  for (const log of receipt.logs || []) {
    if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const token = String(log.address).toLowerCase();
    const from = "0x" + log.topics[1].slice(26); const rcpt = "0x" + log.topics[2].slice(26);
    if (token === USDBC_BASE && (!to || rcpt === to)) bridged++;
    if (token !== USDC_BASE) continue;
    transfers.push({ from, to: rcpt, amount: fmt6(BigInt(log.data)), units: BigInt(log.data).toString(), logIndex: Number(log.logIndex) });
  }
  const toMe = to ? transfers.filter(t => t.to === to) : transfers;
  const total = toMe.reduce((a, t) => a + BigInt(t.units), 0n);
  const success = receipt.status === "0x1";
  const checks = {
    txSucceeded: success,
    nativeUsdcToRecipient: toMe.length > 0,
    amountAtLeastMin: total >= minUnits,
    confirmationsAtLeast: confirmations >= needConf,
  };
  const ok = Object.values(checks).every(Boolean);
  return { status: 200, body: {
    tx, network: "eip155:8453", found: true, block: Number(BigInt(receipt.blockNumber)), confirmations,
    usdcContract: USDC_BASE, recipient: to || null, receivedUsdc: fmt6(total), minRequired: q.min || null,
    transfers: toMe, checks, verdict: ok ? "paid" : "not_paid",
    warnings: bridged ? ["Recipient got bridged USDbC (0xd9aA...), which is NOT native Circle USDC."] : [],
  } };
}

function decodeB64Json(s: string): any { try { return JSON.parse(atob(s)); } catch { return null; } }

/** Fetch an x402 resource unpaid and audit its payment requirements before an agent signs. */
export async function preflightX402(q: { url?: string; method?: string }) {
  let target: URL;
  try { target = new URL(q.url || ""); } catch { return { status: 400, body: { error: "url must be an absolute https URL" } }; }
  if (target.protocol !== "https:") return { status: 400, body: { error: "only https URLs are checked" } };
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(target.hostname)) return { status: 400, body: { error: "private hosts are not allowed" } };
  const method = (q.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(target.toString(), { method, redirect: "manual", headers: { accept: "application/json", "user-agent": "zero-payment-guard/1.0" },
      body: method === "POST" ? "{}" : undefined, signal: AbortSignal.timeout(8000) });
  } catch (e) { return { status: 200, body: { url: target.toString(), reachable: false, verdict: "block", flags: ["unreachable: " + String(e)] } }; }
  const latencyMs = Date.now() - t0;
  const text = (await res.text()).slice(0, 200_000);
  const flags: string[] = []; const notes: string[] = [];
  if (res.status !== 402) {
    return { status: 200, body: { url: target.toString(), reachable: true, httpStatus: res.status, latencyMs,
      verdict: res.status < 300 ? "free_or_unprotected" : "caution", flags: [`expected HTTP 402, got ${res.status}`] } };
  }
  let pr: any = null; let version = 0;
  const hdr = res.headers.get("payment-required");
  if (hdr) { pr = decodeB64Json(hdr); version = pr?.x402Version || 2; }
  if (!pr) { try { pr = JSON.parse(text); version = pr?.x402Version || 1; } catch { /* */ } }
  if (!pr || !Array.isArray(pr.accepts) || pr.accepts.length === 0) {
    return { status: 200, body: { url: target.toString(), httpStatus: 402, latencyMs, verdict: "block", flags: ["402 without a parseable x402 accepts[] list"] } };
  }
  const options = [];
  for (const a of pr.accepts.slice(0, 10)) {
    const network = V1_NETWORKS[a.network] || a.network;
    const asset = String(a.asset || ""); const canon = CANONICAL_USDC[network];
    const isEvm = String(network).startsWith("eip155:");
    const assetOk = !!canon && (isEvm ? asset.toLowerCase() === canon : asset === canon);
    const units = (() => { try { return BigInt(a.amount ?? a.maxAmountRequired ?? "0"); } catch { return -1n; } })();
    const usd = assetOk && units >= 0n ? Number(units) / 1e6 : null;
    const o: any = { scheme: a.scheme, network, asset, assetIsCircleUsdc: assetOk, amountUnits: units.toString(), priceUsd: usd,
      payTo: a.payTo, maxTimeoutSeconds: a.maxTimeoutSeconds ?? null, flags: [] as string[] };
    if (!canon) o.flags.push("network has no Circle USDC in our table");
    else if (!assetOk) o.flags.push("asset is NOT Circle-issued USDC on this network (possible bridged/fake token)");
    if (usd !== null && usd >= 1) o.flags.push(`high price for a single call: $${usd}`);
    if (units < 0n) o.flags.push("unparseable amount");
    if (a.scheme !== "exact") o.flags.push(`scheme ${a.scheme} (not exact): check spending cap semantics`);
    if ((a.maxTimeoutSeconds ?? 0) > 3600) o.flags.push("payment authorization valid > 1h");
    if (network === "eip155:8453" && isAddr(a.payTo || "")) {
      try {
        const [code, bal] = await Promise.all([
          rpc("eth_getCode", [a.payTo, "latest"]),
          rpc("eth_call", [{ to: USDC_BASE, data: "0x70a08231" + a.payTo.slice(2).toLowerCase().padStart(64, "0") }, "latest"]),
        ]);
        o.payToIsContract = code && code !== "0x"; o.payToUsdcBalance = fmt6(BigInt(bal || "0x0"));
      } catch { o.flags.push("could not read payTo on Base"); }
    }
    options.push(o);
  }
  const anyGood = options.some(o => o.assetIsCircleUsdc);
  if (!anyGood) flags.push("no option pays in Circle-issued USDC");
  if (!pr.resource?.description && !pr.description && !options.some((o: any) => o.description)) notes.push("no description supplied");
  const bazaar = pr.extensions?.bazaar ? true : false;
  for (const o of options) o.verdict = o.flags.some((f: string) => f.includes("NOT Circle")) ? "block" : o.flags.length ? "caution" : "ok";
  const rank: Record<string, number> = { ok: 0, caution: 1, block: 2 };
  const best = options.reduce((m: string, o: any) => (rank[o.verdict] < rank[m] ? o.verdict : m), "block");
  const worst = flags.length && best === "ok" ? "caution" : best;
  return { status: 200, body: { url: target.toString(), httpStatus: 402, x402Version: version, latencyMs,
    resource: pr.resource || null, declaresBazaarDiscovery: bazaar, options, flags, notes, verdict: worst,
    disclaimer: "Automated read-only check; it does not guarantee the seller delivers." } };
}
