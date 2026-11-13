// Node runner for ZERO Payment Guard (same app as the Worker). Usage: npx tsx src/node.ts  (PORT default 8790)
import { serve } from "@hono/node-server";
import app from "./index";
const env = { PAY_TO: "0x857B162e7817D385ED1Dc895c3823BeE42D0ebE5", NETWORK: "eip155:8453", FACILITATOR_URL: "https://facilitator.xpay.sh" };
const port = Number(process.env.PORT || 8790);
serve({ fetch: (req: Request) => app.fetch(req, env as any, { waitUntil() {}, passThroughOnException() {} } as any), port, hostname: "127.0.0.1" });
console.log("listening", port);
