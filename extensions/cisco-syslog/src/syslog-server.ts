// UDP and TCP syslog server. Parses incoming messages and calls the handler callback.
import { createSocket } from "node:dgram";
import { createServer as createTcpServer } from "node:net";
import type { ParsedSyslogMessage } from "./types.js";
import { parseSyslogMessage } from "./syslog-parser.js";

export type SyslogMessageHandler = (msg: ParsedSyslogMessage) => void;

export type SyslogServerOptions = {
  udpPort?: number;
  tcpPort?: number;
  bindAddress?: string;
  onMessage: SyslogMessageHandler;
  onError?: (err: Error, transport: "udp" | "tcp") => void;
};

export type SyslogServer = {
  stop: () => Promise<void>;
  udpPort: number | undefined;
  tcpPort: number | undefined;
};

const MAX_SYSLOG_MESSAGE_SIZE = 65535;

/** Start a UDP (and optionally TCP) syslog server. Returns a handle to stop it. */
export function startSyslogServer(opts: SyslogServerOptions): SyslogServer {
  const {
    udpPort,
    tcpPort,
    bindAddress = "0.0.0.0",
    onMessage,
    onError,
  } = opts;

  let activeUdpPort: number | undefined;
  let activeTcpPort: number | undefined;
  const teardowns: (() => Promise<void>)[] = [];

  // UDP server
  if (udpPort !== undefined) {
    const udpSocket = createSocket("udp4");

    udpSocket.on("message", (data, rinfo) => {
      try {
        const raw = data.toString("utf-8");
        const parsed = parseSyslogMessage(raw, rinfo.address);
        onMessage(parsed);
      } catch {
        // Silently drop malformed datagrams
      }
    });

    udpSocket.on("error", (err) => {
      onError?.(err, "udp");
    });

    udpSocket.bind(udpPort, bindAddress);
    activeUdpPort = udpPort;

    teardowns.push(
      () =>
        new Promise<void>((resolve) => {
          udpSocket.close(() => resolve());
        }),
    );
  }

  // TCP server (newline-framed syslog messages)
  if (tcpPort !== undefined) {
    const tcpServer = createTcpServer((socket) => {
      const remoteAddress = socket.remoteAddress ?? "unknown";
      let buffer = "";

      socket.on("data", (data) => {
        buffer += data.toString("utf-8");
        // Guard against oversized messages from misbehaving senders.
        if (buffer.length > MAX_SYSLOG_MESSAGE_SIZE) {
          socket.destroy();
          return;
        }
        // Process complete lines (newline-framed messages, RFC 6587 octet-count optional)
        const lines = buffer.split("\n");
        // Keep the last (possibly incomplete) fragment
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          // Handle RFC 6587 octet-count framing: "<digits> <msg>"
          const octetCountMatch = /^(\d+) (.*)$/s.exec(trimmed);
          const rawMsg = octetCountMatch ? (octetCountMatch[2] ?? trimmed) : trimmed;
          try {
            const parsed = parseSyslogMessage(rawMsg, remoteAddress);
            onMessage(parsed);
          } catch {
            // Silently drop malformed messages
          }
        }
      });

      socket.on("error", (err) => {
        onError?.(err, "tcp");
      });
    });

    tcpServer.on("error", (err) => {
      onError?.(err, "tcp");
    });

    tcpServer.listen(tcpPort, bindAddress);
    activeTcpPort = tcpPort;

    teardowns.push(
      () =>
        new Promise<void>((resolve, reject) => {
          tcpServer.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }),
    );
  }

  return {
    udpPort: activeUdpPort,
    tcpPort: activeTcpPort,
    stop: async () => {
      await Promise.all(teardowns.map((fn) => fn()));
    },
  };
}
