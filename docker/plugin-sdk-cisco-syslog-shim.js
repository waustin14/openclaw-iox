"use strict";
// Shim: re-exports symbols the cisco-syslog extension needs from individual plugin-sdk subpaths.
// This file is only needed when the published openclaw package does not ship
// dist/plugin-sdk/cisco-syslog.js. Once a version includes the real barrel, the Dockerfile
// skips copying this shim (the exports-entry check gates it).

Object.defineProperty(exports, "__esModule", { value: true });

const channelReplyPipeline = require("./channel-reply-pipeline.js");
exports.createChannelReplyPipeline = channelReplyPipeline.createChannelReplyPipeline;

const runtime = require("./runtime.js");
exports.waitForAbortSignal = runtime.waitForAbortSignal;

// --- resolveInboundRouteEnvelopeBuilderWithRuntime ---
// Inlined from src/plugin-sdk/inbound-envelope.ts — pure helper with no external deps.
// Not shipped as its own subpath in this openclaw version.

function createInboundEnvelopeBuilder(params) {
  var storePath = params.resolveStorePath(params.sessionStore, {
    agentId: params.route.agentId,
  });
  var envelopeOptions = params.resolveEnvelopeFormatOptions(params.cfg);
  return function (input) {
    var previousTimestamp = params.readSessionUpdatedAt({
      storePath: storePath,
      sessionKey: params.route.sessionKey,
    });
    var body = params.formatAgentEnvelope({
      channel: input.channel,
      from: input.from,
      timestamp: input.timestamp,
      previousTimestamp: previousTimestamp,
      envelope: envelopeOptions,
      body: input.body,
    });
    return { storePath: storePath, body: body };
  };
}

function resolveInboundRouteEnvelopeBuilder(params) {
  var route = params.resolveAgentRoute({
    cfg: params.cfg,
    channel: params.channel,
    accountId: params.accountId,
    peer: params.peer,
  });
  var buildEnvelope = createInboundEnvelopeBuilder({
    cfg: params.cfg,
    route: route,
    sessionStore: params.sessionStore,
    resolveStorePath: params.resolveStorePath,
    readSessionUpdatedAt: params.readSessionUpdatedAt,
    resolveEnvelopeFormatOptions: params.resolveEnvelopeFormatOptions,
    formatAgentEnvelope: params.formatAgentEnvelope,
  });
  return { route: route, buildEnvelope: buildEnvelope };
}

function resolveInboundRouteEnvelopeBuilderWithRuntime(params) {
  return resolveInboundRouteEnvelopeBuilder({
    cfg: params.cfg,
    channel: params.channel,
    accountId: params.accountId,
    peer: params.peer,
    resolveAgentRoute: function (routeParams) {
      return params.runtime.routing.resolveAgentRoute(routeParams);
    },
    sessionStore: params.sessionStore,
    resolveStorePath: params.runtime.session.resolveStorePath,
    readSessionUpdatedAt: params.runtime.session.readSessionUpdatedAt,
    resolveEnvelopeFormatOptions: params.runtime.reply.resolveEnvelopeFormatOptions,
    formatAgentEnvelope: params.runtime.reply.formatAgentEnvelope,
  });
}

exports.createInboundEnvelopeBuilder = createInboundEnvelopeBuilder;
exports.resolveInboundRouteEnvelopeBuilder = resolveInboundRouteEnvelopeBuilder;
exports.resolveInboundRouteEnvelopeBuilderWithRuntime = resolveInboundRouteEnvelopeBuilderWithRuntime;
