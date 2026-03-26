import { buildChannelOutboundSessionRoute } from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "./runtime-api.js";

export function resolveWebexOutboundSessionRoute(params: {
  cfg: OpenClawConfig;
  accountId: string;
  agentId: string;
  roomId: string;
  roomType: "direct" | "group";
  botId: string;
}) {
  const { cfg, accountId, agentId, roomId, roomType, botId } = params;
  return buildChannelOutboundSessionRoute({
    cfg,
    agentId,
    channel: "webex",
    accountId,
    peer: {
      kind: roomType === "group" ? "group" : "direct",
      id: roomId,
    },
    chatType: roomType === "group" ? "group" : "direct",
    from: `webex:${botId}`,
    to: `webex:${roomId}`,
  });
}
