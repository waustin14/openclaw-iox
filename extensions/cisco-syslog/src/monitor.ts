// Syslog + telemetry monitor: starts servers and routes parsed events to the agent.
import {
  createChannelReplyPipeline,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  waitForAbortSignal,
  type OpenClawConfig,
} from "./runtime-api.js";
import { getCiscoSyslogRuntime } from "./runtime.js";
import { startSyslogServer } from "./syslog-server.js";
import { startTelemetryServer } from "./telemetry-server.js";
import { formatSyslogMessage, syslogDedupeKey } from "./syslog-parser.js";
import type { ParsedSyslogMessage, CiscoSyslogAccountConfig, CiscoMdtPayload } from "./types.js";

export type CiscoSyslogMonitorOptions = {
  config: OpenClawConfig;
  channelConfig: CiscoSyslogAccountConfig;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
  abortSignal: AbortSignal;
  setStatus: (patch: Record<string, unknown>) => void;
};

/** Start syslog and telemetry servers, route events to agent, and wait until aborted. */
export async function monitorCiscoSyslog(opts: CiscoSyslogMonitorOptions): Promise<void> {
  const { config, channelConfig, runtime, abortSignal } = opts;
  const {
    udpPort = 5514,
    tcpPort,
    bindAddress = "0.0.0.0",
    telemetryHttpPort,
    allowFrom = [],
    minSeverity = 5,
    dedupeWindowSec = 30,
    outboundChannel,
  } = channelConfig;

  // Simple dedupe cache: key → last-seen timestamp (ms)
  const dedupeCache = new Map<string, number>();
  const dedupeTtlMs = dedupeWindowSec * 1000;

  function isDuplicate(key: string): boolean {
    if (dedupeTtlMs <= 0) {
      return false;
    }
    const last = dedupeCache.get(key);
    if (last !== undefined && Date.now() - last < dedupeTtlMs) {
      return true;
    }
    dedupeCache.set(key, Date.now());
    return false;
  }

  // Periodically evict stale dedupe entries to prevent unbounded map growth.
  const dedupeSweepInterval =
    dedupeTtlMs > 0
      ? setInterval(() => {
          const cutoff = Date.now() - dedupeTtlMs;
          for (const [k, ts] of dedupeCache) {
            if (ts < cutoff) {
              dedupeCache.delete(k);
            }
          }
        }, dedupeTtlMs)
      : undefined;

  const allowFromStrings = allowFrom.map((v) => String(v));

  function isSourceAllowed(ip: string): boolean {
    if (allowFromStrings.length === 0) {
      return true;
    }
    return allowFromStrings.includes(ip) || allowFromStrings.includes("*");
  }

  async function routeSyslogToAgent(msg: ParsedSyslogMessage): Promise<void> {
    if (msg.severity > minSeverity) {
      return;
    }
    if (!isSourceAllowed(msg.sourceIp)) {
      return;
    }
    const dedupe = syslogDedupeKey(msg);
    if (isDuplicate(dedupe)) {
      return;
    }

    const formatted = formatSyslogMessage(msg);
    const core = getCiscoSyslogRuntime();
    const sessionId = `cisco-syslog:${msg.sourceIp}`;

    try {
      const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
        cfg: config,
        channel: "cisco-syslog",
        accountId: "default",
        peer: { kind: "direct" as const, id: sessionId },
        runtime: core.channel,
        sessionStore: config.session?.store,
      });

      const { storePath, body } = buildEnvelope({
        channel: "Cisco Syslog",
        from: msg.hostname ?? msg.sourceIp,
        timestamp: msg.timestamp,
        body: formatted,
      });

      const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: body,
        BodyForAgent: formatted,
        RawBody: msg.raw,
        CommandBody: formatted,
        From: `syslog:${msg.sourceIp}`,
        To: `cisco-syslog:${msg.sourceIp}`,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: "direct",
        ConversationLabel: msg.hostname ?? msg.sourceIp,
        SenderName: msg.hostname ?? msg.sourceIp,
        SenderId: msg.sourceIp,
        CommandAuthorized: true,
        Provider: "cisco-syslog",
        Surface: "cisco-syslog",
        OriginatingChannel: "cisco-syslog",
        OriginatingTo: `cisco-syslog:${msg.sourceIp}`,
      });

      await core.channel.session.recordInboundSession({
        storePath,
        sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
        ctx: ctxPayload,
        onRecordError: (err) => {
          runtime.error?.(`cisco-syslog: session record error: ${String(err)}`);
        },
      });

      // Resolve outbound channel and target for agent reply delivery.
      // When outboundChannel is "webex", route through the Webex channel using the
      // configured room ID so the agent's response reaches the Webex room.
      const replyChannel = outboundChannel ?? "cisco-syslog";
      const webexRoomId =
        outboundChannel === "webex"
          ? (config as Record<string, unknown> & { channels?: { webex?: { roomId?: string } } })
              .channels?.webex?.roomId
          : undefined;
      // Set OriginatingChannel + OriginatingTo so dispatch-from-config routes the reply
      // through the configured outbound channel (shouldRouteToOriginating = true), bypassing
      // cisco-syslog's no-op outbound path entirely.
      const replyCtx =
        webexRoomId != null
          ? { ...ctxPayload, To: webexRoomId, OriginatingChannel: replyChannel, OriginatingTo: webexRoomId }
          : ctxPayload;

      const { onModelSelected: _omit, ...replyPipeline } = createChannelReplyPipeline({
        cfg: config,
        agentId: route.agentId,
        channel: replyChannel,
        accountId: "default",
      });

      await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: replyCtx,
        cfg: config,
        dispatcherOptions: {
          ...replyPipeline,
          onError: (err) => {
            runtime.error?.(`cisco-syslog: dispatch error: ${String(err)}`);
          },
        },
      });
    } catch (err) {
      runtime.error?.(`cisco-syslog: failed routing message: ${String(err)}`);
    }
  }

  async function routeTelemetryToAgent(
    payload: CiscoMdtPayload,
    sourceIp: string,
  ): Promise<void> {
    const nodeId = payload.node_id ?? sourceIp;
    const path = payload.encoding_path ?? "telemetry";
    const body = `[${nodeId}] MDT ${path} collection_id=${String(payload.collection_id ?? "?")}`;
    const core = getCiscoSyslogRuntime();
    const sessionId = `cisco-syslog:${sourceIp}`;

    try {
      const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
        cfg: config,
        channel: "cisco-syslog",
        accountId: "default",
        peer: { kind: "direct" as const, id: sessionId },
        runtime: core.channel,
        sessionStore: config.session?.store,
      });

      const { storePath, body: mdtBody } = buildEnvelope({
        channel: "Cisco MDT",
        from: nodeId,
        timestamp: payload.msg_timestamp ?? Date.now(),
        body,
      });

      const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: mdtBody,
        BodyForAgent: body,
        RawBody: body,
        CommandBody: body,
        From: `mdt:${nodeId}`,
        To: `cisco-syslog:${sourceIp}`,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: "direct",
        ConversationLabel: nodeId,
        SenderName: nodeId,
        SenderId: sourceIp,
        CommandAuthorized: true,
        Provider: "cisco-syslog",
        Surface: "cisco-syslog",
        OriginatingChannel: "cisco-syslog",
        OriginatingTo: `cisco-syslog:${sourceIp}`,
      });

      await core.channel.session.recordInboundSession({
        storePath,
        sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
        ctx: ctxPayload,
        onRecordError: (err) => {
          runtime.error?.(`cisco-syslog: mdt session record error: ${String(err)}`);
        },
      });

      const replyChannel = outboundChannel ?? "cisco-syslog";
      const webexRoomId =
        outboundChannel === "webex"
          ? (config as Record<string, unknown> & { channels?: { webex?: { roomId?: string } } })
              .channels?.webex?.roomId
          : undefined;
      // Set OriginatingChannel + OriginatingTo so dispatch-from-config routes the reply
      // through the configured outbound channel (shouldRouteToOriginating = true), bypassing
      // cisco-syslog's no-op outbound path entirely.
      const replyCtx =
        webexRoomId != null
          ? { ...ctxPayload, To: webexRoomId, OriginatingChannel: replyChannel, OriginatingTo: webexRoomId }
          : ctxPayload;

      const { onModelSelected: _omit, ...replyPipeline } = createChannelReplyPipeline({
        cfg: config,
        agentId: route.agentId,
        channel: replyChannel,
        accountId: "default",
      });

      await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: replyCtx,
        cfg: config,
        dispatcherOptions: {
          ...replyPipeline,
          onError: (err) => {
            runtime.error?.(`cisco-syslog: mdt dispatch error: ${String(err)}`);
          },
        },
      });
    } catch (err) {
      runtime.error?.(`cisco-syslog: failed routing MDT payload: ${String(err)}`);
    }
  }

  // Start syslog server
  const syslogServer = startSyslogServer({
    udpPort,
    tcpPort,
    bindAddress,
    onMessage: (msg) => {
      void routeSyslogToAgent(msg).catch((err: unknown) => {
        runtime.error?.(`cisco-syslog: unhandled error: ${String(err)}`);
      });
    },
    onError: (err, transport) => {
      runtime.error?.(`cisco-syslog: ${transport} server error: ${err.message}`);
    },
  });

  const ports = [
    udpPort !== undefined ? `udp:${String(udpPort)}` : null,
    tcpPort !== undefined ? `tcp:${String(tcpPort)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  runtime.log?.(`cisco-syslog: listening on ${bindAddress} [${ports}] minSeverity=${String(minSeverity)}`);

  // Start telemetry HTTP server if configured
  let telemetryServer: ReturnType<typeof startTelemetryServer> | undefined;
  if (telemetryHttpPort !== undefined) {
    telemetryServer = startTelemetryServer({
      port: telemetryHttpPort,
      bindAddress,
      onMessage: (payload, sourceIp) => {
        void routeTelemetryToAgent(payload, sourceIp).catch((err: unknown) => {
          runtime.error?.(`cisco-syslog: mdt handler error: ${String(err)}`);
        });
      },
      onError: (err) => {
        runtime.error?.(`cisco-syslog: telemetry http server error: ${err.message}`);
      },
    });
    runtime.log?.(
      `cisco-syslog: telemetry HTTP receiver on ${bindAddress}:${String(telemetryHttpPort)}/telemetry`,
    );
  }

  await waitForAbortSignal(abortSignal);

  // Clean up dedupe sweep timer and servers
  if (dedupeSweepInterval !== undefined) {
    clearInterval(dedupeSweepInterval);
  }
  await syslogServer.stop().catch((err: unknown) => {
    runtime.error?.(`cisco-syslog: error stopping syslog server: ${String(err)}`);
  });
  if (telemetryServer) {
    await telemetryServer.stop().catch((err: unknown) => {
      runtime.error?.(`cisco-syslog: error stopping telemetry server: ${String(err)}`);
    });
  }

  runtime.log?.("cisco-syslog: provider stopped");
}
