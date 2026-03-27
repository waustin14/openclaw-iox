import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { buildChannelOutboundSessionRoute, createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { CiscoSyslogConfigSchema } from "./config-schema.js";
import type { CiscoSyslogAccountConfig, CiscoSyslogConfig } from "./types.js";
import type { OpenClawConfig } from "./runtime-api.js";

const DEFAULT_ACCOUNT_ID = "default";

const meta = {
  id: "cisco-syslog",
  label: "Cisco Syslog",
  selectionLabel: "Cisco Syslog (UDP/TCP receiver)",
  docsPath: "/channels/cisco-syslog",
  docsLabel: "cisco-syslog",
  blurb: "Receive syslog and Model-Driven Telemetry from Cisco network devices.",
  aliases: ["syslog"],
  order: 90,
};

function resolveCiscoSyslogConfig(cfg: OpenClawConfig): CiscoSyslogAccountConfig {
  return (cfg.channels?.["cisco-syslog"] as CiscoSyslogConfig | undefined) ?? {};
}

export const ciscoSyslogPlugin = createChatChannelPlugin({
  base: {
    id: "cisco-syslog",
    meta,
    capabilities: {
      // Receive-only channel: syslog events come in but the agent's replies
      // are logged/discarded rather than delivered back to a device.
      chatTypes: ["direct"],
      polls: false,
      reactions: false,
      threads: false,
      media: false,
    },
    reload: { configPrefixes: ["channels.cisco-syslog"] },
    configSchema: buildChannelConfigSchema(CiscoSyslogConfigSchema),
    config: {
      listAccountIds: (cfg) => {
        const channelCfg = cfg.channels?.["cisco-syslog"] as CiscoSyslogConfig | undefined;
        if (!channelCfg || channelCfg.enabled === false) {
          return [];
        }
        return [DEFAULT_ACCOUNT_ID];
      },
      resolveAccount: (cfg, _accountId) => ({
        accountId: DEFAULT_ACCOUNT_ID,
        name: "Cisco Syslog",
        enabled: (cfg.channels?.["cisco-syslog"] as CiscoSyslogConfig | undefined)?.enabled !== false,
        configured: true,
        extra: {},
      }),
      isConfigured: (_account, _cfg) => true,
      describeAccount: (_account, _cfg) => ({
        accountId: DEFAULT_ACCOUNT_ID,
        label: "Cisco Syslog receiver",
        configured: true,
        enabled: true,
      }),
      defaultAccountId: (_cfg) => DEFAULT_ACCOUNT_ID,
    },
    messaging: {
      normalizeTarget: (raw) => raw?.trim() || undefined,
      resolveOutboundSessionRoute: async (params) => {
        // Outbound is not meaningful for syslog but required by the interface.
        return buildChannelOutboundSessionRoute({
          cfg: params.cfg,
          agentId: params.agentId,
          channel: "cisco-syslog",
          accountId: params.accountId,
          peer: { kind: "direct", id: params.target },
          chatType: "direct",
          from: "cisco-syslog:agent",
          to: `cisco-syslog:${params.target}`,
        });
      },
    },
    status: createComputedAccountStatusAdapter({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      collectStatusIssues: (_accounts) => [],
      buildChannelSummary: ({ snapshot: _snapshot }) => ({
        ok: true,
        summary: "Listening for syslog",
      }),
      probeAccount: async (_params) => ({
        ok: true,
        summary: "Syslog server active",
        elapsedMs: 0,
      }),
      resolveAccountSnapshot: ({ account: _account }) => ({
        accountId: DEFAULT_ACCOUNT_ID,
        name: "Cisco Syslog",
        enabled: true,
        configured: true,
        extra: {},
      }),
    }),
    gateway: {
      startAccount: async (ctx) => {
        ctx.log?.info("cisco-syslog: starting syslog and telemetry receiver");
        const channelConfig = resolveCiscoSyslogConfig(ctx.cfg);
        const { monitorCiscoSyslog } = await import("./monitor.js");
        return monitorCiscoSyslog({
          config: ctx.cfg,
          channelConfig,
          runtime: {
            log: ctx.log?.info,
            error: ctx.log?.error,
          },
          abortSignal: ctx.abortSignal,
          setStatus: ctx.setStatus,
        });
      },
    },
  },
  // No outbound delivery — this is a receive-only channel.
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4096,
    chunkerMode: "length",
    sendText: async ({ to }) => {
      // No-op: replies from the agent are discarded for syslog events.
      return { channel: "cisco-syslog" as const, messageId: to };
    },
  },
});
