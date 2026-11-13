// Remote MCP endpoint (stateless streamable HTTP, JSON responses). Paid tools use x402-over-MCP (@x402/mcp).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPaymentWrapper } from "@x402/mcp";
import { x402ResourceServer } from "@x402/core/server";
import { CachedFacilitatorClient } from "./fac";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { z } from "zod";
import { verifyUsdcPayment, preflightX402 } from "./checks";
import { tokenCheck, basename } from "./checks2";
import { walletSnapshot, txStatus } from "./checks3";
import { pageExtract } from "./extract";
import { domainEnrich } from "./enrich";
import { companyBrief, pageExtractBatch } from "./bundle";

async function server402(env: any) {
  // Per request: never await an init promise created by another request (Workers hang). /supported is cached as data.
  const rs = new x402ResourceServer(new CachedFacilitatorClient({ url: env.FACILITATOR_URL })).register(env.NETWORK, new ExactEvmScheme());
  await rs.initialize(); return rs;
}
const asText = (o: any) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }], structuredContent: o });
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

type ToolDef = { name: string; title: string; price: string; description: string; input: any; run: (a: any) => Promise<any> };
const TOOLS: ToolDef[] = [
  { name: "company_brief", title: "Company brief (enrichment + homepage/About Markdown)", price: "$0.003",
    description: "One call to research a company: everything domain_enrich returns (socials, email provider, SPF/DMARC, DNS provider, RDAP age, tech stack, SaaS signals) plus its homepage and About page as clean Markdown.",
    input: { domain: z.string().min(3).describe("Domain, URL or work email"), maxChars: z.number().int().min(500).max(20000).optional().describe("Max Markdown chars per page, default 6000") },
    run: async a => { const r = await companyBrief({ domain: a.domain, maxChars: a.maxChars ? String(a.maxChars) : "" }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; } },
  { name: "page_extract_batch", title: "Batch page extract (up to 10 URLs)", price: "$0.008",
    description: "Extract up to 10 public web pages in parallel to clean Markdown + metadata. Per-URL errors are inline; fails (not charged) only if no URL succeeds.",
    input: { urls: z.array(z.string().url()).min(1).max(10).describe("Public http(s) URLs"), maxChars: z.number().int().min(500).max(30000).optional().describe("Max Markdown chars per page, default 8000") },
    run: async a => { const r = await pageExtractBatch({ urls: a.urls.join(","), maxChars: a.maxChars ? String(a.maxChars) : "" }, {}); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; } },
  { name: "domain_enrich", title: "Company/domain enrichment", price: "$0.002",
    description: "Domain, URL or work email to a company profile from public sources: name, description, logo, social profiles, homepage contact emails/phones; email provider from MX, SPF/DMARC policy; DNS provider; SaaS signals from TXT verifications; RDAP registrar, creation date, age, expiry; website tech stack.",
    input: { domain: z.string().min(3).describe("Domain (stripe.com), URL, or work email"), site: z.boolean().optional().describe("false = skip homepage fetch (DNS+RDAP only)") },
    run: async a => { const r = await domainEnrich({ domain: a.domain, site: a.site === false ? "0" : "1" }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; } },
  { name: "page_extract", title: "Web page to Markdown + metadata", price: "$0.001",
    description: "Fetch a public web page and return its main content as clean Markdown plus metadata: title, description, canonical, language, author, dates, OpenGraph/Twitter card, JSON-LD types, headings outline, favicon, feeds, link counts (links=true for the list). Honours robots.txt.",
    input: { url: z.string().url().describe("Public http(s) URL"), maxChars: z.number().int().min(500).max(100000).optional().describe("Max Markdown chars, default 20000"), links: z.boolean().optional().describe("Include up to 150 links") },
    run: async a => { const r = await pageExtract({ url: a.url, maxChars: a.maxChars ? String(a.maxChars) : "", links: a.links ? "1" : "0" }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; } },
  { name: "x402_preflight", title: "x402 payment preflight", price: "$0.005",
    description: "Before your agent pays an unknown x402 endpoint: fetch its 402 unpaid and check the asset is canonical Circle USDC for that network, price/scheme/timeout sanity, and payTo (contract or EOA, USDC balance on Base). Returns verdict ok/caution/block with per-option flags.",
    input: { url: z.string().url().describe("https URL of the x402 resource to check"), method: z.enum(["GET", "POST"]).optional().describe("HTTP method, default GET") },
    run: async a => (await preflightX402(a)).body },
  { name: "usdc_payment_check", title: "Base USDC payment verification", price: "$0.002",
    description: "Verify a Base mainnet transaction paid native Circle USDC (not bridged USDbC) to a recipient, with minimum amount and confirmations. Use before releasing goods or marking an invoice paid. Verdict paid/not_paid/not_found.",
    input: { tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Base tx hash"), to: z.string().optional().describe("Expected recipient 0x address"), min: z.string().optional().describe("Minimum USDC, e.g. 1.5"), minConfirmations: z.string().optional().describe("Default 1") },
    run: async a => (await verifyUsdcPayment(a)).body },
  { name: "token_check", title: "Base token safety check", price: "$0.003",
    description: "Before accepting, swapping or approving a token on Base: is it a contract, ERC-20 metadata, canonical official deployment (USDC, EURC, WETH, cbBTC...), impersonation of a major symbol, upgradeable proxy and admin type, owner, paused. Verdict canonical/ok/caution/block.",
    input: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Token/contract address on Base") },
    run: async a => (await tokenCheck(a)).body },
  { name: "basename_resolve", title: "Basename resolve (forward/reverse)", price: "$0.001",
    description: "Resolve a Basename (alice.base.eth) to its Base address, or an address to its primary Basename with forward-verification. Use before sending funds to a name.",
    input: { name: z.string().optional().describe("Basename, e.g. alice or alice.base.eth"), address: z.string().optional().describe("0x address for reverse lookup") },
    run: async a => (await basename(a)).body },
  { name: "wallet_snapshot", title: "Base wallet snapshot", price: "$0.002",
    description: "One call: ETH and canonical Base token balances (native USDC, USDbC, EURC, WETH, cbBTC, cbETH, DAI, USDT), nonce, EOA or contract, flags (fresh/unused address, holds bridged USDbC). Use before sending funds or accepting a counterparty.",
    input: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Base address") },
    run: async a => (await walletSnapshot(a)).body },
  { name: "tx_status", title: "Base transaction status", price: "$0.001",
    description: "State not_found/pending/success/reverted, block, confirmations, from/to, fee in ETH (incl. L1 fee), method selector, decoded ERC-20 Transfer events with symbols/amounts (canonical tokens flagged). Use to confirm a payment, swap or call landed.",
    input: { tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Base tx hash") },
    run: async a => (await txStatus(a)).body },
];

// Builds the MCP server. Payment requirements are built lazily on the first call of each paid tool,
// so initialize and tools/list never touch the facilitator (works offline, e.g. for directory introspection).
export function buildMcp(env: any, origin: string): McpServer {
  const mcp = new McpServer({ name: "zero-payment-guard", version: "1.5.1" });
  for (const t of TOOLS) {
    let wrapped: ((a: any, extra: any) => Promise<any>) | null = null;
    const handler = async (a: any, extra: any) => {
      if (!wrapped) {
        const srv = await server402(env);
        const accepts = await srv.buildPaymentRequirements({ scheme: "exact", network: env.NETWORK, payTo: env.PAY_TO, price: t.price, maxTimeoutSeconds: 120 } as any);
        const paid = createPaymentWrapper(srv, { accepts, resource: { url: `${origin}/mcp#${t.name}`, description: t.description, mimeType: "application/json", serviceName: "ZERO Payment Guard", tags: t.name.startsWith("page_extract") ? ["web", "scrape", "markdown", "metadata"] : t.name === "domain_enrich" || t.name === "company_brief" ? ["enrichment", "company", "domain", "dns", "tech-stack"] : ["x402", "base", "usdc", "safety"] } } as any);
        wrapped = paid(async (args: any) => asText(await t.run(args))) as any;
      }
      return wrapped!(a, extra);
    };
    mcp.registerTool(t.name, { title: `${t.title} (${t.price} USDC on Base via x402)`, description: `Paid ${t.price} per call (x402, USDC on Base). ${t.description}`, inputSchema: t.input, annotations: RO } as any, handler as any);
  }
  mcp.registerTool("sample_report", { title: "Free sample (live preflight + token check)", description: "Free: real live x402 preflight of a fixed sample endpoint and a token check of USDC on Base, same shapes as the paid tools.", inputSchema: {}, annotations: RO } as any,
    async () => asText({ preflight: (await preflightX402({ url: "https://api.onesource.io/api/chain/erc20-balance", method: "GET" })).body, token_check: (await tokenCheck({ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" })).body }));
  return mcp;
}

export async function handleMcp(req: Request, env: any): Promise<Response> {
  const mcp = buildMcp(env, new URL(req.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcp.connect(transport);
  return transport.handleRequest(req);
}
