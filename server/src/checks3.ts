// Cheap composable Base chain reads: wallet snapshot and transaction status. Read-only via public Base RPCs.
import { encodeFunctionData, decodeFunctionResult, parseAbi, getAddress, formatUnits, hexToString } from "viem";
import { rpc } from "./checks";
import { CANONICAL } from "./checks2";

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isHash = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);
const DEC: Record<string, number> = { USDC: 6, USDbC: 6, EURC: 6, WETH: 18, cbBTC: 8, cbETH: 18, DAI: 18, USDT: 6 };
const ABI = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const hexNum = (h: string) => (h ? Number(BigInt(h)) : 0);

async function erc(to: string, fn: "balanceOf" | "symbol" | "decimals", args: any[] = []): Promise<any> {
  try {
    const r = await rpc("eth_call", [{ to, data: encodeFunctionData({ abi: ABI, functionName: fn, args } as any) }, "latest"]);
    if (!r || r === "0x") return undefined;
    try { return decodeFunctionResult({ abi: ABI, functionName: fn, data: r } as any); }
    catch { if (fn === "symbol") { try { return hexToString(r, { size: 32 }).replace(/\0/g, ""); } catch {} } return undefined; }
  } catch { return undefined; }
}

export async function walletSnapshot(q: { address?: string }) {
  const a = (q.address || "").trim();
  if (!isAddr(a)) return { status: 400, body: { error: "address must be a 0x 20-byte address" } };
  const addr = getAddress(a);
  const tokens = Object.entries(CANONICAL);
  const [eth, nonce, code, block, ...bals] = await Promise.all([
    rpc("eth_getBalance", [addr, "latest"]), rpc("eth_getTransactionCount", [addr, "latest"]), rpc("eth_getCode", [addr, "latest"]), rpc("eth_blockNumber", []),
    ...tokens.map(([t]) => erc(t, "balanceOf", [addr]))]);
  const balances: Record<string, string> = {};
  tokens.forEach(([t, m], i) => { const v = bals[i]; if (v !== undefined && BigInt(v) > 0n) balances[m.symbol] = formatUnits(BigInt(v), DEC[m.symbol] ?? 18); });
  const isContract = !!code && code !== "0x";
  const flags: string[] = [];
  if (!isContract && hexNum(nonce) === 0 && BigInt(eth) === 0n && !Object.keys(balances).length) flags.push("fresh_or_unused_address");
  if (balances.USDbC) flags.push("holds_bridged_USDbC_not_native_USDC");
  if (isContract) flags.push("is_contract");
  return { status: 200, body: {
    address: addr, network: "eip155:8453", block: hexNum(block), isContract, nonce: hexNum(nonce),
    eth: formatUnits(BigInt(eth), 18), usdc: balances.USDC ?? "0", tokens: balances, flags,
    tokensChecked: tokens.map(([t, m]) => ({ symbol: m.symbol, address: getAddress(t) })),
    note: "Balances of ETH and the canonical Base tokens listed in tokensChecked at the given block. Other tokens are not scanned." } };
}

export async function txStatus(q: { tx?: string }) {
  const h = (q.tx || "").trim();
  if (!isHash(h)) return { status: 400, body: { error: "tx must be a 0x 32-byte transaction hash" } };
  const [tx, rc, head] = await Promise.all([rpc("eth_getTransactionByHash", [h]).catch(() => null), rpc("eth_getTransactionReceipt", [h]).catch(() => null), rpc("eth_blockNumber", [])]);
  if (!tx) return { status: 200, body: { tx: h, network: "eip155:8453", found: false, state: "not_found", note: "Unknown to Base mainnet RPC: wrong chain, dropped, or not yet propagated." } };
  if (!rc) return { status: 200, body: { tx: h, network: "eip155:8453", found: true, state: "pending", from: getAddress(tx.from), to: tx.to ? getAddress(tx.to) : null, valueEth: formatUnits(BigInt(tx.value), 18) } };
  const meta: Record<string, { symbol: string; decimals: number }> = {};
  const logs = (rc.logs || []).filter((l: any) => l.topics?.[0] === TRANSFER && l.topics.length === 3);
  const unknown = [...new Set(logs.map((l: any) => l.address.toLowerCase()))].filter((t: any) => !CANONICAL[t]).slice(0, 5) as string[];
  for (const [t, m] of Object.entries(CANONICAL)) meta[t] = { symbol: m.symbol, decimals: DEC[m.symbol] ?? 18 };
  await Promise.all(unknown.map(async t => { const [s, d] = await Promise.all([erc(t, "symbol"), erc(t, "decimals")]); meta[t] = { symbol: s ? String(s) : "?", decimals: d !== undefined ? Number(d) : 18 }; }));
  const transfers = logs.slice(0, 50).map((l: any) => { const t = l.address.toLowerCase(); const m = meta[t]; const raw = BigInt(l.data && l.data !== "0x" ? l.data : "0x0");
    return { token: getAddress(t), symbol: m?.symbol ?? "?", canonical: !!CANONICAL[t], from: getAddress("0x" + l.topics[1].slice(-40)), to: getAddress("0x" + l.topics[2].slice(-40)), amount: m ? formatUnits(raw, m.decimals) : raw.toString(), decimalsKnown: !!m }; });
  const gasUsed = BigInt(rc.gasUsed), price = BigInt(rc.effectiveGasPrice || tx.gasPrice || "0x0");
  const l1 = rc.l1Fee ? BigInt(rc.l1Fee) : 0n;
  const conf = hexNum(head) - hexNum(rc.blockNumber) + 1;
  return { status: 200, body: {
    tx: h, network: "eip155:8453", found: true, state: rc.status === "0x1" ? "success" : "reverted", success: rc.status === "0x1",
    block: hexNum(rc.blockNumber), confirmations: conf, from: getAddress(rc.from), to: rc.to ? getAddress(rc.to) : null, contractCreated: rc.contractAddress ? getAddress(rc.contractAddress) : null,
    valueEth: formatUnits(BigInt(tx.value), 18), nonce: hexNum(tx.nonce), gasUsed: gasUsed.toString(), feeEth: formatUnits(gasUsed * price + l1, 18),
    methodSelector: tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null, logCount: (rc.logs || []).length, tokenTransfers: transfers,
    note: "tokenTransfers decodes ERC-20 Transfer events (first 50); canonical=true marks official Base deployments (native USDC, EURC, WETH, cbBTC...)." } };
}
