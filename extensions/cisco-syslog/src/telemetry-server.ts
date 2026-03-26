// HTTP endpoint for receiving Cisco Model-Driven Telemetry (MDT) JSON payloads.
// Cisco IOS XE/XR can stream telemetry to HTTP collectors via gRPC or HTTP.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CiscoMdtPayload } from "./types.js";

export type TelemetryMessageHandler = (payload: CiscoMdtPayload, sourceIp: string) => void;

export type TelemetryServerOptions = {
  port: number;
  bindAddress?: string;
  path?: string;
  onMessage: TelemetryMessageHandler;
  onError?: (err: Error) => void;
};

export type TelemetryServer = {
  stop: () => Promise<void>;
  port: number;
};

const MAX_BODY_SIZE = 1_048_576; // 1 MiB

/** Start an HTTP telemetry receiver for Cisco MDT JSON payloads. */
export function startTelemetryServer(opts: TelemetryServerOptions): TelemetryServer {
  const {
    port,
    bindAddress = "0.0.0.0",
    path: expectedPath = "/telemetry",
    onMessage,
    onError,
  } = opts;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqPath = (req.url ?? "/").split("?")[0];
    if (req.method !== "POST" || reqPath !== expectedPath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    let body = "";
    let size = 0;
    const sourceIp = req.socket.remoteAddress ?? "unknown";

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      body += chunk.toString("utf-8");
    });

    req.on("end", () => {
      if (res.headersSent) {
        return;
      }
      try {
        const payload = JSON.parse(body) as CiscoMdtPayload;
        onMessage(payload, sourceIp);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"status":"ok"}');
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request: invalid JSON");
      }
    });

    req.on("error", (err: Error) => {
      onError?.(err);
    });
  });

  server.on("error", (err: Error) => {
    onError?.(err);
  });

  server.listen(port, bindAddress);

  return {
    port,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}
