// Lazy-loaded gateway runtime for the Webex channel.
import { probeWebex } from "./probe.js";
import type { ResolvedWebexAccount } from "./accounts.js";
import type { OpenClawConfig } from "./runtime-api.js";
import type { WebexFetch } from "./webex-api.js";

export { probeWebex };

export async function sendWebexText(params: {
  to: string;
  text: string;
  token: string;
  accountId?: string;
  cfg: OpenClawConfig;
  fetcher?: WebexFetch;
}): Promise<void> {
  const { sendMessageWebex } = await import("./send.js");
  await sendMessageWebex({
    roomId: params.to,
    text: params.text,
    token: params.token,
    accountId: params.accountId,
    fetcher: params.fetcher,
  });
}

export async function startWebexGatewayAccount(
  ctx: {
    account: ResolvedWebexAccount;
    runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
    abortSignal: AbortSignal;
    cfg: OpenClawConfig;
    accountId: string;
    setStatus: (patch: Record<string, unknown>) => void;
  },
): Promise<void> {
  const { monitorWebexProvider } = await import("./monitor.js");
  return monitorWebexProvider({
    token: ctx.account.botToken!,
    account: ctx.account,
    config: ctx.cfg,
    runtime: ctx.runtime,
    abortSignal: ctx.abortSignal,
    setStatus: ctx.setStatus,
    accountId: ctx.accountId,
  });
}
