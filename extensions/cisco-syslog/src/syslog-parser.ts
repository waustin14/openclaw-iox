// Syslog message parser supporting RFC 3164 and common Cisco formats.
import type { ParsedSyslogMessage, SyslogSeverity } from "./types.js";
import { SYSLOG_SEVERITY_NAMES } from "./types.js";

const RFC3164_REGEX =
  /^<(\d+)>(?:(\w{3}\s+\d+\s+\d+:\d+:\d+)\s+)?(\S+)\s+(\S+?)(?:\[(\d+)\])?\s*:\s*(.*)$/s;

const RFC5424_REGEX =
  /^<(\d+)>1\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S*)\s*(.*)$/s;

/**
 * Parse a raw syslog datagram (RFC 3164 or RFC 5424).
 * Falls back to a best-effort parse if neither regex matches.
 */
export function parseSyslogMessage(raw: string, sourceIp: string): ParsedSyslogMessage {
  const trimmed = raw.trim();
  const timestamp = Date.now();

  // Try RFC 5424 first
  const m5 = RFC5424_REGEX.exec(trimmed);
  if (m5) {
    const pri = parseInt(m5[1] ?? "13", 10);
    const facility = Math.floor(pri / 8);
    const severity = pri % 8;
    return {
      facility,
      severity,
      severityName: SYSLOG_SEVERITY_NAMES[severity] ?? "notice",
      sourceIp,
      hostname: m5[3] === "-" ? undefined : (m5[3] ?? undefined),
      tag: m5[4] === "-" ? undefined : (m5[4] ?? undefined),
      pid: m5[5] && m5[5] !== "-" ? parseInt(m5[5], 10) : undefined,
      message: m5[8]?.trim() ?? trimmed,
      raw: trimmed,
      timestamp,
    };
  }

  // Try RFC 3164
  const m3 = RFC3164_REGEX.exec(trimmed);
  if (m3) {
    const pri = parseInt(m3[1] ?? "13", 10);
    const facility = Math.floor(pri / 8);
    const severity = pri % 8;
    return {
      facility,
      severity,
      severityName: SYSLOG_SEVERITY_NAMES[severity] ?? "notice",
      sourceIp,
      hostname: m3[3] ?? undefined,
      tag: m3[4] ?? undefined,
      pid: m3[5] ? parseInt(m3[5], 10) : undefined,
      message: m3[6]?.trim() ?? trimmed,
      raw: trimmed,
      timestamp,
    };
  }

  // Best-effort: extract priority if present
  const priMatch = /^<(\d+)>/.exec(trimmed);
  const pri = priMatch ? parseInt(priMatch[1] ?? "13", 10) : 13;
  const facility = Math.floor(pri / 8);
  const severity = pri % 8;

  return {
    facility,
    severity,
    severityName: SYSLOG_SEVERITY_NAMES[severity] ?? "notice",
    sourceIp,
    message: priMatch ? trimmed.slice(priMatch[0].length).trim() : trimmed,
    raw: trimmed,
    timestamp,
  };
}

/**
 * Format a parsed syslog message as a human-readable string for the agent.
 */
export function formatSyslogMessage(msg: ParsedSyslogMessage): string {
  const parts: string[] = [];

  if (msg.hostname ?? msg.sourceIp) {
    parts.push(`[${msg.hostname ?? msg.sourceIp}]`);
  }
  parts.push(`${msg.severityName.toUpperCase()}`);
  if (msg.tag) {
    const tagStr = msg.pid !== undefined ? `${msg.tag}[${String(msg.pid)}]` : msg.tag;
    parts.push(`${tagStr}:`);
  }
  parts.push(msg.message);

  return parts.join(" ");
}

/**
 * Build the deduplication key for a syslog message (used to suppress repeats).
 */
export function syslogDedupeKey(msg: ParsedSyslogMessage): string {
  return `${msg.sourceIp}|${String(msg.facility)}|${String(msg.severity)}|${msg.tag ?? ""}|${msg.message}`;
}
