import { WebexApiError, getWebexSelf } from "./webex-api.js";
import type { WebexFetch } from "./webex-api.js";

export type WebexProbeResult =
  | { ok: true; botId: string; botName: string; elapsedMs: number }
  | { ok: false; error: string; elapsedMs: number };

export async function probeWebex(
  token: string,
  timeoutMs?: number,
  fetcher?: WebexFetch,
): Promise<WebexProbeResult> {
  const start = Date.now();
  try {
    const self = await Promise.race([
      getWebexSelf(token, fetcher),
      ...(timeoutMs
        ? [
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("probe timeout")), timeoutMs),
            ),
          ]
        : []),
    ]);
    return {
      ok: true,
      botId: self.id,
      botName: self.displayName ?? self.firstName ?? "Webex Bot",
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    const message =
      err instanceof WebexApiError
        ? `HTTP ${String(err.statusCode)}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: message, elapsedMs: Date.now() - start };
  }
}
