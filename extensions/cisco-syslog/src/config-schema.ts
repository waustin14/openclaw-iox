import { AllowFromListSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "zod";

export const CiscoSyslogConfigSchema = z.object({
  enabled: z.boolean().optional(),
  // UDP port to listen for syslog (RFC 3164/5424). Avoid 514 unless running as root.
  udpPort: z.number().int().min(1).max(65535).optional().default(5514),
  // Optional TCP port for syslog over TCP. Disabled if not set.
  tcpPort: z.number().int().min(1).max(65535).optional(),
  // Bind address. Defaults to "0.0.0.0" (all interfaces).
  bindAddress: z.string().optional().default("0.0.0.0"),
  // Optional HTTP telemetry endpoint port (Cisco Model-Driven Telemetry over HTTP/JSON).
  telemetryHttpPort: z.number().int().min(1).max(65535).optional(),
  // Allowlist of source IPs. If empty, accepts from all sources.
  allowFrom: AllowFromListSchema,
  // Minimum syslog severity to forward to the agent (0=emerg, 7=debug). Default 5 (notice).
  minSeverity: z.number().int().min(0).max(7).optional().default(5),
  // Route all syslog events to a specific agent ID (optional).
  agentId: z.string().optional(),
  // Suppress repeated identical messages within this window (seconds). Default 30.
  dedupeWindowSec: z.number().int().min(0).optional().default(30),
  // Channel to use for agent reply delivery (e.g. "webex"). If unset, replies are discarded.
  outboundChannel: z.string().optional(),
});
