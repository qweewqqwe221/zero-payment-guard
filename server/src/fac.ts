import { HTTPFacilitatorClient } from "@x402/core/server";

// Workers runtimes cannot await a promise whose I/O started in another request: a module-level
// init promise can hang every later request when its first request is cancelled. So we cache only
// the RESOLVED /supported data (plain object) and fetch it inside the current request when missing.
const supportedCache = new Map<string, { at: number; data: any }>();
const TTL_MS = 10 * 60 * 1000;

export class CachedFacilitatorClient extends HTTPFacilitatorClient {
  private key: string;
  constructor(config: any) { super(config); this.key = String(config?.url ?? "default"); }
  async getSupported(): Promise<any> {
    const hit = supportedCache.get(this.key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    const data = await super.getSupported();
    supportedCache.set(this.key, { at: Date.now(), data });
    return data;
  }
}
