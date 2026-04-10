// Monitor: handles both webhook-based and polling-based inbound messages from Webex.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import {
  createChannelPairingController,
  createChannelReplyPipeline,
  resolveDirectDmAuthorizationOutcome,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  resolveSenderCommandAuthorizationWithRuntime,
  waitForAbortSignal,
} from "./runtime-api.js";
import { createHmacValidator } from "./webhook-security.js";
import type { ResolvedWebexAccount } from "./accounts.js";
import type { OpenClawConfig } from "./runtime-api.js";
import { getWebexMessage, getWebexSelf } from "./webex-api.js";
import type { WebexFetch, WebexApiError } from "./webex-api.js";
import type { WebexWebhookEvent } from "./types.js";
import { probeWebex } from "./probe.js";
import {
  registerPluginHttpRoute,
} from "openclaw/plugin-sdk/webhook-ingress";
import { resolveWebhookPath } from "openclaw/plugin-sdk/webhook-ingress";
import {
  createWebexWebhook,
  listWebexWebhooks,
  updateWebexWebhook,
} from "./webex-api.js";
import { getWebexRuntime } from "./runtime.js";

const WEBEX_WEBHOOK_NAME = "openclaw-webex-bot";
const WEBEX_TEXT_CHUNK_LIMIT = 7439; // Webex message text limit

type WebexMonitorOptions = {
  token: string;
  botId: string;
  botName: string;
  account: ResolvedWebexAccount;
  config: OpenClawConfig;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
  abortSignal: AbortSignal;
  fetcher?: WebexFetch;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

// Global webhook target map: path → array of active accounts
const webexWebhookTargets = new Map<string, WebexMonitorOptions[]>();

/** Register the HTTP route and listen for webhook events from Webex. */
function registerWebexWebhookTarget(opts: WebexMonitorOptions, path: string): () => void {
  const existing = webexWebhookTargets.get(path) ?? [];
  if (existing.length === 0) {
    // Register the HTTP route the first time a target is added for this path.
    registerPluginHttpRoute({
      path,
      auth: "plugin",
      match: "exact",
      replaceExisting: true,
      source: "webex-webhook",
      pluginId: "webex",
      log: opts.runtime.log,
      handler: async (req, res) => {
        await handleWebexWebhookRequest(req, res);
      },
    });
  }
  webexWebhookTargets.set(path, [...existing, opts]);

  return () => {
    const current = webexWebhookTargets.get(path) ?? [];
    const updated = current.filter((t) => t !== opts);
    if (updated.length === 0) {
      webexWebhookTargets.delete(path);
    } else {
      webexWebhookTargets.set(path, updated);
    }
  };
}

/** Handle an inbound HTTP POST from Webex's webhook. */
async function handleWebexWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Read body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const rawBody = Buffer.concat(chunks).toString("utf-8");

  let event: WebexWebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebexWebhookEvent;
  } catch {
    res.statusCode = 400;
    res.end("Bad Request");
    return;
  }

  // Only process messages:created events
  if (event.resource !== "messages" || event.event !== "created") {
    res.statusCode = 200;
    res.end("OK");
    return;
  }

  // Find a registered target for the incoming path
  const url = req.url ?? "";
  const normalizedPath = url.split("?")[0] ?? url;
  const targets = webexWebhookTargets.get(normalizedPath) ?? [];

  res.statusCode = 200;
  res.end("OK");

  // Process against all matching targets (usually just one per path)
  for (const target of targets) {
    // Validate HMAC signature if secret is configured
    const secret = target.account.config.webhookSecret;
    if (secret) {
      const signature = req.headers["x-spark-signature"] as string | undefined;
      if (!validateWebhookSignature(rawBody, signature, secret)) {
        target.runtime.log?.(`[${target.account.accountId}] webex: invalid webhook signature, dropping event`);
        continue;
      }
    }

    // Skip messages sent by the bot itself
    if (event.actorId === target.botId) {
      continue;
    }

    void processWebhookEvent(target, event).catch((err: unknown) => {
      target.runtime.error?.(
        `[${target.account.accountId}] webex: error processing webhook event: ${String(err)}`,
      );
    });
  }
}

function validateWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }
  const validator = createHmacValidator(secret);
  return validator(rawBody, signature);
}

async function processWebhookEvent(
  opts: WebexMonitorOptions,
  event: WebexWebhookEvent,
): Promise<void> {
  const { token, account, config, runtime, fetcher, statusSink } = opts;
  const messageId = event.data.id;
  const roomId = event.data.roomId;
  const roomType = event.data.roomType ?? "direct";
  const personId = event.actorId ?? event.data.personId ?? "";

  opts.statusSink?.({ lastInboundAt: Date.now() });

  // Fetch the full message content from Webex API
  let message;
  try {
    message = await getWebexMessage(token, messageId, fetcher);
  } catch (err) {
    runtime.error?.(
      `[${account.accountId}] webex: failed to fetch message ${messageId}: ${String(err)}`,
    );
    return;
  }

  const rawText = (message.text ?? "").trim();
  if (!rawText) {
    return;
  }

  const isGroup = roomType === "group";
  const core = getWebexRuntime();
  const pairing = createChannelPairingController({
    core,
    channel: "webex",
    accountId: account.accountId,
  });

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configuredAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));

  const { senderAllowedForCommands, commandAuthorized } =
    await resolveSenderCommandAuthorizationWithRuntime({
      cfg: config,
      rawBody: rawText,
      isGroup,
      dmPolicy,
      configuredAllowFrom,
      configuredGroupAllowFrom: (account.config.groupAllowFrom ?? []).map((v) => String(v)),
      senderId: personId,
      isSenderAllowed: (id, allowFrom) => allowFrom.includes(id),
      readAllowFromStore: pairing.readAllowFromStore,
      runtime: core.channel.commands,
    });

  const directDmOutcome = resolveDirectDmAuthorizationOutcome({
    isGroup,
    dmPolicy,
    senderAllowedForCommands,
  });

  if (directDmOutcome === "disabled") {
    runtime.log?.(`[${account.accountId}] webex: blocked DM from ${personId} (dmPolicy=disabled)`);
    return;
  }

  if (directDmOutcome === "unauthorized") {
    if (dmPolicy === "pairing") {
      await pairing.issueChallenge({
        senderId: personId,
        senderIdLine: `Your Webex person ID: ${personId}`,
        meta: { name: message.personEmail ?? undefined },
        onCreated: () => {
          runtime.log?.(`[${account.accountId}] webex: pairing request sender=${personId}`);
        },
        sendPairingReply: async (text) => {
          const { sendMessageWebex } = await import("./send.js");
          await sendMessageWebex({ roomId, text, token, fetcher });
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onReplyError: (err) => {
          runtime.log?.(`[${account.accountId}] webex: pairing reply failed: ${String(err)}`);
        },
      });
    } else {
      runtime.log?.(
        `[${account.accountId}] webex: blocked unauthorized sender ${personId} (dmPolicy=${dmPolicy})`,
      );
    }
    return;
  }

  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg: config,
    channel: "webex",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? ("group" as const) : ("direct" as const),
      id: roomId,
    },
    runtime: core.channel,
    sessionStore: config.session?.store,
  });

  const senderLabel = message.personEmail ?? `user:${personId}`;
  const { storePath, body } = buildEnvelope({
    channel: "Webex",
    from: senderLabel,
    timestamp: message.created ? new Date(message.created).getTime() : undefined,
    body: rawText,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawText,
    RawBody: rawText,
    CommandBody: rawText,
    From: isGroup ? `webex:group:${roomId}` : `webex:${personId}`,
    To: `webex:${roomId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: senderLabel,
    SenderName: message.personEmail ?? undefined,
    SenderId: personId,
    CommandAuthorized: commandAuthorized,
    Provider: "webex",
    Surface: "webex",
    MessageSid: messageId,
    OriginatingChannel: "webex",
    OriginatingTo: `webex:${roomId}`,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`[${account.accountId}] webex: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected: _omit, ...replyPipeline } = createChannelReplyPipeline({
    cfg: config,
    agentId: route.agentId,
    channel: "webex",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...replyPipeline,
      deliver: async (payload: { text?: string }) => {
        const replyText = payload.text?.trim();
        if (!replyText) {
          return;
        }
        const { sendMessageWebex } = await import("./send.js");
        await sendMessageWebex({ roomId, text: replyText, token, fetcher });
        statusSink?.({ lastOutboundAt: Date.now() });
      },
      onDeliveryError: (err) => {
        runtime.error?.(
          `[${account.accountId}] webex: delivery error to ${roomId}: ${String(err)}`,
        );
      },
    },
  });
}

/** Start the Webex gateway provider for one account. Registers webhook and waits for abort. */
export async function monitorWebexProvider(opts: {
  token: string;
  account: ResolvedWebexAccount;
  config: OpenClawConfig;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
  abortSignal: AbortSignal;
  fetcher?: WebexFetch;
  setStatus: (patch: Record<string, unknown>) => void;
  accountId: string;
}): Promise<void> {
  const { token, account, config, runtime, abortSignal, fetcher, setStatus } = opts;

  // Probe to get bot identity
  const probe = await probeWebex(token, 3000, fetcher);
  if (!probe.ok) {
    runtime.error?.(
      `[${account.accountId}] webex: probe failed: ${probe.error}`,
    );
    throw new Error(`Webex probe failed: ${probe.error}`);
  }

  const botId = probe.botId;
  const botName = probe.botName;

  setStatus({
    accountId: account.accountId,
    botId,
    botName,
  });

  runtime.log?.(`[${account.accountId}] webex: started bot="${botName}" id=${botId}`);

  const statusSink = createAccountStatusSink({
    accountId: account.accountId,
    setStatus,
  });

  const monitorOpts: WebexMonitorOptions = {
    token,
    botId,
    botName,
    account,
    config,
    runtime,
    abortSignal,
    fetcher,
    statusSink,
  };

  // Register webhook if webhookUrl is configured
  const webhookUrl = account.config.webhookUrl?.trim();
  if (webhookUrl) {
    const webhookPath = resolveWebhookPath({
      webhookUrl,
      defaultPath: `/webhooks/webex/${account.accountId}`,
    });

    // Register with Webex API
    await ensureWebexWebhook({
      token,
      webhookUrl,
      webhookSecret: account.config.webhookSecret,
      runtime,
      accountId: account.accountId,
      fetcher,
    });

    const unregister = registerWebexWebhookTarget(monitorOpts, webhookPath);
    runtime.log?.(`[${account.accountId}] webex: webhook mode active path=${webhookPath}`);
    if (!account.config.webhookSecret) {
      runtime.log?.(
        `[${account.accountId}] webex: WARNING: webhookSecret not set — incoming webhook requests will not be signature-validated; set channels.webex.webhookSecret for production use`,
      );
    }

    await waitForAbortSignal(abortSignal);
    unregister();
  } else {
    runtime.log?.(
      `[${account.accountId}] webex: no webhookUrl configured — set channels.webex.webhookUrl to enable inbound messages`,
    );
    await waitForAbortSignal(abortSignal);
  }

  runtime.log?.(`[${account.accountId}] webex: provider stopped`);
}

/** Ensure a webhook is registered with Webex, creating or updating as needed. */
async function ensureWebexWebhook(params: {
  token: string;
  webhookUrl: string;
  webhookSecret?: string;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
  accountId: string;
  fetcher?: WebexFetch;
}): Promise<void> {
  const { token, webhookUrl, webhookSecret, runtime, accountId, fetcher } = params;

  try {
    const { items } = await listWebexWebhooks(token, fetcher);
    const existing = items.find(
      (wh) =>
        wh.name === WEBEX_WEBHOOK_NAME &&
        wh.resource === "messages" &&
        wh.event === "created",
    );

    if (existing) {
      // Always update the webhook to sync the targetUrl and secret.
      // The Webex API does not return the secret, so we cannot diff it;
      // re-sending is idempotent and ensures the registered secret
      // matches the current config.
      await updateWebexWebhook(
        token,
        existing.id,
        { name: WEBEX_WEBHOOK_NAME, targetUrl: webhookUrl, secret: webhookSecret },
        fetcher,
      );
      if (existing.targetUrl !== webhookUrl) {
        runtime.log?.(`[${accountId}] webex: updated webhook targetUrl=${webhookUrl}`);
      } else {
        runtime.log?.(`[${accountId}] webex: webhook already registered targetUrl=${webhookUrl}`);
      }
    } else {
      await createWebexWebhook(
        token,
        {
          name: WEBEX_WEBHOOK_NAME,
          targetUrl: webhookUrl,
          resource: "messages",
          event: "created",
          secret: webhookSecret,
        },
        fetcher,
      );
      runtime.log?.(`[${accountId}] webex: registered webhook targetUrl=${webhookUrl}`);
    }
  } catch (err) {
    runtime.error?.(
      `[${accountId}] webex: failed to register webhook: ${String(err)}`,
    );
    throw err;
  }
}
