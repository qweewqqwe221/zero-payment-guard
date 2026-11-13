// Stdio MCP entrypoint (same tools as the hosted /mcp endpoint). Usage: npx tsx src/stdio.ts
// Paid tools answer with an x402 payment request (USDC on Base) unless the call carries a valid payment.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcp } from "./mcp";

const env = {
  PAY_TO: process.env.PAY_TO || "0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5",
  NETWORK: process.env.NETWORK || "eip155:8453",
  FACILITATOR_URL: process.env.FACILITATOR_URL || "https://facilitator.payai.network",
};
const origin = process.env.PUBLIC_ORIGIN || "https://zero-payment-guard.worker.beacon.host";
const mcp = buildMcp(env, origin);
mcp.connect(new StdioServerTransport()).catch(e => { console.error(e); process.exit(1); });
