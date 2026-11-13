# Hosted MCP server

The ZERO Payment Guard MCP server is hosted; there is nothing to install.

- Endpoint (streamable HTTP): `https://zero-payment-guard.worker.beacon.host/mcp`
- Registry name: `host.beacon.worker.zero-payment-guard/payment-guard` (official MCP Registry)
- `server.json` in this folder is the manifest published to the registry.

Client config (any MCP client that supports remote servers):

```json
{
  "mcpServers": {
    "zero-payment-guard": {
      "type": "http",
      "url": "https://zero-payment-guard.worker.beacon.host/mcp"
    }
  }
}
```

Listing tools is free. Tool calls other than `sample_report` are paid per call with x402 (USDC on Base); the tool description states each price.
