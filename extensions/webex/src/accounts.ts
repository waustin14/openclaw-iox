import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { normalizeSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { OpenClawConfig } from "./runtime-api.js";
import type { ResolvedWebexAccount, WebexAccountConfig, WebexConfig } from "./types.js";

export type { ResolvedWebexAccount };

const { listAccountIds: listWebexAccountIds, resolveDefaultAccountId: resolveDefaultWebexAccountId } =
  createAccountListHelpers("webex");
export { listWebexAccountIds, resolveDefaultWebexAccountId };

function mergeWebexAccountConfig(cfg: OpenClawConfig, accountId: string): WebexAccountConfig {
  const channelCfg = cfg.channels?.webex as WebexConfig | undefined;
  if (!channelCfg) {
    return {};
  }
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const { accounts: _accounts, defaultAccount: _default, ...base } = channelCfg;
    return base as WebexAccountConfig;
  }
  const { accounts: _accounts, defaultAccount: _default, ...base } = channelCfg;
  const accountOverride = (channelCfg.accounts?.[accountId] ?? {}) as Partial<WebexAccountConfig>;
  return { ...base, ...accountOverride } as WebexAccountConfig;
}

export function resolveWebexAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  allowUnresolvedSecretRef?: boolean;
}): ResolvedWebexAccount {
  const accountId = normalizeAccountId(params.accountId);
  const channelCfg = params.cfg.channels?.webex as WebexConfig | undefined;
  const baseEnabled = channelCfg?.enabled !== false;
  const merged = mergeWebexAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const rawToken = merged.botToken;
  const botToken = rawToken
    ? normalizeSecretInputString(rawToken, { allowUnresolved: params.allowUnresolvedSecretRef })
    : undefined;

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    configured: Boolean(botToken),
    botToken: botToken ?? undefined,
    config: merged,
  };
}

export function listEnabledWebexAccounts(cfg: OpenClawConfig): ResolvedWebexAccount[] {
  return listWebexAccountIds(cfg)
    .map((accountId) => resolveWebexAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
