// Base token/contract safety check and Basename resolution. Read-only via public Base RPCs.
import { namehash, keccak256, toHex, encodeFunctionData, decodeFunctionResult, parseAbi, getAddress, hexToString } from "viem";
import { rpc } from "./checks";

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const ZERO = "0x0000000000000000000000000000000000000000";
// Canonical Base mainnet tokens (lowercase) -> symbol, issuer
export const CANONICAL: Record<string, { symbol: string; issuer: string }> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", issuer: "Circle (native)" },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", issuer: "Bridged USDC (legacy, NOT native)" },
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": { symbol: "EURC", issuer: "Circle (native)" },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", issuer: "OP Stack predeploy" },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC", issuer: "Coinbase" },
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { symbol: "cbETH", issuer: "Coinbase" },
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { symbol: "DAI", issuer: "Bridged DAI" },
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT", issuer: "Bridged USDT" },
};
const WATCHED_SYMBOLS = new Set(["USDC", "USDT", "EURC", "WETH", "ETH", "CBBTC", "CBETH", "DAI", "USDBC"]);
const ERC20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function owner() view returns (address)", "function paused() view returns (bool)"]);
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const LEGACY_IMPL_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3"; // OpenZeppelin zos AdminUpgradeabilityProxy (e.g. USDC)
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

async function call(to: string, fn: any): Promise<any> {
  try {
    const data = encodeFunctionData({ abi: ERC20, functionName: fn });
    const r = await rpc("eth_call", [{ to, data }, "latest"]);
    if (!r || r === "0x") return undefined;
    try { return decodeFunctionResult({ abi: ERC20, functionName: fn, data: r }); }
    catch { if (fn === "name" || fn === "symbol") { try { return hexToString(r as `0x${string}`, { size: 32 }).replace(/\0/g, ""); } catch {} } return undefined; }
  } catch { return undefined; }
}
const slotAddr = (v: string) => (v && v !== "0x" && BigInt(v) !== 0n ? getAddress("0x" + v.slice(-40)) : null);

export async function tokenCheck(q: { address?: string }) {
  const a = (q.address || "").trim();
  if (!isAddr(a)) return { status: 400, body: { error: "address must be a 0x 20-byte address" } };
  const addr = a.toLowerCase();
  const code: string = await rpc("eth_getCode", [addr, "latest"]);
  const codeBytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
  const canon = CANONICAL[addr] || null;
  if (!codeBytes) return { status: 200, body: { address: getAddress(addr), network: "eip155:8453", isContract: false, verdict: "block", flags: ["not_a_contract"], note: "No code at this address on Base: it is a wallet (EOA) or undeployed, not a token." } };
  const [name, symbol, decimals, totalSupply, owner, paused, impl, admin] = await Promise.all([
    call(addr, "name"), call(addr, "symbol"), call(addr, "decimals"), call(addr, "totalSupply"), call(addr, "owner"), call(addr, "paused"),
    rpc("eth_getStorageAt", [addr, IMPL_SLOT, "latest"]).then(async (v: string) => (v && v !== "0x" && BigInt(v) !== 0n) ? v : rpc("eth_getStorageAt", [addr, LEGACY_IMPL_SLOT, "latest"])).catch(() => "0x"), rpc("eth_getStorageAt", [addr, ADMIN_SLOT, "latest"]).catch(() => "0x")]);
  const implementation = slotAddr(impl), proxyAdmin = slotAddr(admin);
  const isErc20 = symbol !== undefined && decimals !== undefined && totalSupply !== undefined;
  const flags: string[] = [];
  if (!isErc20) flags.push("not_erc20_like");
  const sym = String(symbol || "").toUpperCase();
  if (!canon && WATCHED_SYMBOLS.has(sym)) flags.push("impersonation_risk: symbol matches a major token but this is not its canonical Base address");
  if (canon && canon.symbol === "USDbC") flags.push("bridged_usdbc_not_native_usdc");
  if (implementation) flags.push("upgradeable_proxy");
  if (owner && owner !== ZERO && !canon) flags.push("has_owner");
  if (paused === true) flags.push("paused");
  let adminIsContract: boolean | null = null;
  if (proxyAdmin) { const ac: string = await rpc("eth_getCode", [proxyAdmin, "latest"]).catch(() => "0x"); adminIsContract = !!ac && ac !== "0x"; if (!adminIsContract && !canon) flags.push("proxy_admin_is_eoa"); }
  const verdict = canon && canon.symbol !== "USDbC" ? "canonical" : flags.some(f => f.startsWith("impersonation") || f === "not_erc20_like" || f === "paused") ? "block" : flags.length ? "caution" : "ok";
  return { status: 200, body: {
    address: getAddress(addr), network: "eip155:8453", isContract: true, codeBytes,
    token: isErc20 ? { name: name ?? null, symbol: symbol ?? null, decimals: Number(decimals), totalSupply: totalSupply?.toString() } : null,
    canonical: canon, proxy: implementation ? { implementation, admin: proxyAdmin, adminIsContract } : null,
    owner: owner && owner !== ZERO ? owner : null, paused: paused ?? null, flags, verdict,
    note: "On-chain facts only (no source audit). 'canonical' = known official Base deployment.",
  } };
}

// Basenames (base.eth) on Base mainnet
const REGISTRY = "0xb94704422c2a1e396835a571837aa5ae53285a95";
const RABI = parseAbi(["function resolver(bytes32 node) view returns (address)", "function addr(bytes32 node) view returns (address)", "function name(bytes32 node) view returns (string)", "function text(bytes32 node, string key) view returns (string)"]);
async function rcall(to: string, fn: any, args: any[]) {
  const r = await rpc("eth_call", [{ to, data: encodeFunctionData({ abi: RABI, functionName: fn, args }) }, "latest"]);
  if (!r || r === "0x") return undefined;
  return decodeFunctionResult({ abi: RABI, functionName: fn, data: r }) as any;
}
async function forward(name: string) {
  const node = namehash(name);
  const resolver = await rcall(REGISTRY, "resolver", [node]);
  if (!resolver || resolver === ZERO) return { resolver: null, address: null };
  const address = await rcall(resolver, "addr", [node]).catch(() => undefined);
  return { resolver, address: address && address !== ZERO ? address : null };
}
export async function basename(q: { name?: string; address?: string }) {
  if (q.name) {
    let n = q.name.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(n)) return { status: 400, body: { error: "name must be like alice or alice.base.eth" } };
    if (!n.includes(".")) n += ".base.eth";
    if (!n.endsWith(".base.eth")) return { status: 400, body: { error: "only Basenames (*.base.eth) are resolved here" } };
    const f = await forward(n);
    return { status: 200, body: { name: n, network: "eip155:8453", address: f.address, resolver: f.resolver, found: !!f.address } };
  }
  const a = (q.address || "").trim();
  if (!isAddr(a)) return { status: 400, body: { error: "give name=<basename> or address=<0x address>" } };
  const rnode = namehash(`${a.slice(2).toLowerCase()}.80002105.reverse`);
  const resolver = await rcall(REGISTRY, "resolver", [rnode]);
  let primary: string | null = null;
  if (resolver && resolver !== ZERO) primary = (await rcall(resolver, "name", [rnode]).catch(() => "")) || null;
  let verified = false;
  if (primary) { const f = await forward(primary); verified = !!f.address && f.address.toLowerCase() === a.toLowerCase(); }
  return { status: 200, body: { address: getAddress(a), network: "eip155:8453", primaryName: primary, forwardMatches: verified, found: !!primary,
    note: primary && !verified ? "Reverse record does not resolve back to this address: do not trust it." : undefined } };
}
