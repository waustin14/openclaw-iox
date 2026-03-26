// Core types for the Cisco Syslog channel extension.

export type CiscoSyslogAccountConfig = {
  enabled?: boolean;
  udpPort?: number;
  tcpPort?: number;
  bindAddress?: string;
  telemetryHttpPort?: number;
  allowFrom?: (string | number)[];
  minSeverity?: number;
  agentId?: string;
  dedupeWindowSec?: number;
};

export type CiscoSyslogConfig = CiscoSyslogAccountConfig;

// RFC 3164 / RFC 5424 parsed syslog message
export type ParsedSyslogMessage = {
  facility: number;
  severity: number;
  // Severity name
  severityName: SyslogSeverity;
  // Source IP address
  sourceIp: string;
  // Hostname from message (if present)
  hostname?: string;
  // Process name / tag
  tag?: string;
  // PID if present
  pid?: number;
  // Message body
  message: string;
  // Raw original message
  raw: string;
  // Timestamp (ms since epoch)
  timestamp: number;
};

export type SyslogSeverity =
  | "emergency"
  | "alert"
  | "critical"
  | "error"
  | "warning"
  | "notice"
  | "info"
  | "debug";

export const SYSLOG_SEVERITY_NAMES: SyslogSeverity[] = [
  "emergency",
  "alert",
  "critical",
  "error",
  "warning",
  "notice",
  "info",
  "debug",
];

// Cisco Model-Driven Telemetry (MDT) over HTTP/gRPC JSON payload
export type CiscoMdtPayload = {
  node_id?: string;
  subscription_id?: string;
  encoding_path?: string;
  collection_id?: number;
  collection_start_time?: number;
  msg_timestamp?: number;
  data_gpbkv?: unknown;
  data_json?: unknown[];
};
