import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import {
  createPairingPrefixStripper,
  createTextPairingAdapter,
} from "openclaw/plugin-sdk/channel-pairing";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import type { ChannelStatusIssue } from "./runtime-api.js";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import { createChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { listResolvedDirectoryUserEntriesFromAllowFrom } from "openclaw/plugin-sdk/directory-runtime";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  listWebexAccountIds,
  resolveDefaultWebexAccountId,
  resolveWebexAccount,
  type ResolvedWebexAccount,
} from "./accounts.js";
import { WebexConfigSchema } from "./config-schema.js";
import type { WebexProbeResult } from "./probe.js";
import type { OpenClawConfig, ChannelPlugin } from "./runtime-api.js";

const WEBEX_TEXT_CHUNK_LIMIT = 7439;
const DEFAULT_ACCOUNT_ID = "default";
const PAIRING_APPROVED_MESSAGE =
  "Pairing approved. You can now send messages to the agent.";

const meta = {
  id: "webex",
  label: "Webex",
  selectionLabel: "Webex (Bot API)",
  docsPath: "/channels/webex",
  docsLabel: "webex",
  blurb: "Cisco Webex messaging via Bot API.",
  aliases: ["wx"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeWebexMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^(webex|wx):/i, "").trim();
}

const loadWebexChannelRuntime = createLazyRuntimeModule(() => import("./channel.runtime.js"));

const webexConfigAdapter = createScopedChannelConfigAdapter<ResolvedWebexAccount>({
  sectionKey: "webex",
  listAccountIds: listWebexAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveWebexAccount),
  defaultAccountId: resolveDefaultWebexAccountId,
  clearBaseFields: [
    "name",
    "botToken",
    "webhookUrl",
    "webhookSecret",
  ],
  resolveAllowFrom: (account) => account.config.allowFrom?.map((v) => String(v)),
  formatAllowFrom: (allowFrom) => allowFrom,
});

const resolveWebexDmPolicy = createScopedDmSecurityResolver<ResolvedWebexAccount>({
  channelKey: "webex",
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom?.map((v) => String(v)),
  allowFromPathSuffix: "",
  normalizeEntry: (raw) => raw.trim().toLowerCase(),
});

export const webexPlugin: ChannelPlugin<ResolvedWebexAccount, WebexProbeResult> =
  createChatChannelPlugin<ResolvedWebexAccount, WebexProbeResult>({
    base: {
      id: "webex",
      meta,
      capabilities: {
        chatTypes: ["direct", "group"],
        polls: false,
        reactions: false,
        threads: false,
        media: false,
      },
      reload: { configPrefixes: ["channels.webex"] },
      configSchema: buildChannelConfigSchema(WebexConfigSchema),
      config: {
        ...webexConfigAdapter,
        isConfigured: (account) => account.configured,
        describeAccount: (account) =>
          describeAccountSnapshot({
            account,
            configured: account.configured,
            extra: {},
          }),
      },
      messaging: {
        normalizeTarget: normalizeWebexMessagingTarget,
        resolveOutboundSessionRoute: async (params) => {
          const { resolveWebexOutboundSessionRoute } = await import("./session-route.js");
          // Determine room type from target prefix
          const target = params.target?.trim() ?? "";
          const isGroup = target.startsWith("group:") || target.startsWith("Y2lz");
          return resolveWebexOutboundSessionRoute({
            cfg: params.cfg as OpenClawConfig,
            accountId: params.accountId,
            agentId: params.agentId,
            roomId: target.replace(/^group:/i, ""),
            roomType: isGroup ? "group" : "direct",
            botId: params.accountId, // use accountId as placeholder
          });
        },
        targetResolver: {
          looksLikeId: (raw) => {
            const trimmed = raw.trim();
            if (!trimmed) {
              return false;
            }
            // Webex IDs are long base64-encoded strings starting with "Y2lz"
            if (/^(webex|wx):/i.test(trimmed)) {
              return true;
            }
            return trimmed.startsWith("Y2lz") && trimmed.length > 40;
          },
          hint: "<roomId|email>",
        },
      },
      directory: createChannelDirectoryAdapter({
        listPeers: async (params) =>
          listResolvedDirectoryUserEntriesFromAllowFrom({
            ...params,
            channelKey: "webex",
            resolveAccount: adaptScopedAccountAccessor(resolveWebexAccount),
            resolveAllowFrom: (account) =>
              account.config.allowFrom?.map((v) => String(v)) ?? [],
          }),
      }),
      status: createComputedAccountStatusAdapter<ResolvedWebexAccount, WebexProbeResult>({
        defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
        collectStatusIssues: (accounts) => {
          const issues: ChannelStatusIssue[] = [];
          for (const account of accounts) {
            if (!account.configured) {
              issues.push({
                accountId: account.accountId,
                severity: "error",
                message: "Webex bot token not configured",
                configPath: "channels.webex.botToken",
              });
            }
            if (!account.config.webhookUrl) {
              issues.push({
                accountId: account.accountId,
                severity: "warning",
                message: "No webhookUrl configured; inbound messages will not be received",
                configPath: "channels.webex.webhookUrl",
              });
            }
          }
          return issues;
        },
        buildChannelSummary: ({ snapshot }) => ({
          ok: snapshot.configured,
          summary: snapshot.configured ? "Connected" : "Not configured",
        }),
        probeAccount: async ({ account, timeoutMs }) => {
          const { probeWebex } = await loadWebexChannelRuntime();
          if (!account.botToken) {
            return { ok: false, error: "No bot token configured", elapsedMs: 0 };
          }
          return probeWebex(account.botToken, timeoutMs);
        },
        resolveAccountSnapshot: ({ account, runtime: _runtime }) => ({
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: account.configured,
          extra: {},
        }),
      }),
      gateway: {
        startAccount: async (ctx) => {
          const account = ctx.account;
          if (!account.botToken) {
            throw new Error(`[${account.accountId}] Webex bot token not configured`);
          }
          ctx.setStatus({ accountId: account.accountId });
          ctx.log?.info(`[${account.accountId}] webex: starting provider`);
          const { startWebexGatewayAccount } = await loadWebexChannelRuntime();
          return startWebexGatewayAccount({
            account,
            runtime: {
              log: ctx.log?.info,
              error: ctx.log?.error,
            },
            abortSignal: ctx.abortSignal,
            cfg: ctx.cfg,
            accountId: ctx.accountId,
            setStatus: ctx.setStatus,
          });
        },
      },
    },
    security: {
      resolveDmPolicy: resolveWebexDmPolicy,
    },
    pairing: {
      text: {
        idLabel: "webexPersonId",
        message: PAIRING_APPROVED_MESSAGE,
        normalizeAllowEntry: createPairingPrefixStripper(/^(webex|wx):/i),
        notify: async ({ id, message, accountId, cfg }) => {
          const account = resolveWebexAccount({ cfg: cfg as OpenClawConfig, accountId });
          if (!account.botToken) {
            throw new Error("Webex token not configured");
          }
          const { sendMessageWebex } = await import("./send.js");
          await sendMessageWebex({
            roomId: id,
            text: message,
            token: account.botToken,
          });
        },
      },
    },
    outbound: {
      deliveryMode: "direct",
      textChunkLimit: WEBEX_TEXT_CHUNK_LIMIT,
      chunkerMode: "length",
      sendText: async ({ to, text, accountId, cfg }) => {
        const account = resolveWebexAccount({ cfg: cfg as OpenClawConfig, accountId });
        if (!account.botToken) {
          throw new Error(`Webex outbound: no token for account ${accountId ?? DEFAULT_ACCOUNT_ID}`);
        }
        const { sendWebexText } = await loadWebexChannelRuntime();
        await sendWebexText({
          to,
          text,
          token: account.botToken,
          accountId: accountId ?? undefined,
          cfg: cfg as OpenClawConfig,
        });
        return { channel: "webex" as const, messageId: to };
      },
    },
  });
