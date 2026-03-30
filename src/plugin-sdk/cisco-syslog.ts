// Plugin SDK barrel for the cisco-syslog channel extension.
// Exports the subset of core symbols needed by the cisco-syslog plugin.
export { createChannelReplyPipeline } from "./channel-reply-pipeline.js";
export { resolveInboundRouteEnvelopeBuilderWithRuntime } from "./inbound-envelope.js";
export { waitForAbortSignal } from "../infra/abort-signal.js";
export type { OpenClawConfig } from "../config/config.js";
