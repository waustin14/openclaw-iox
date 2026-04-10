import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the scripts directory relative to this module at runtime.
// This works whether the extension is loaded from the repo or from
// /opt/openclaw-plugins/cisco-pyats/ in the IOx container.
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts");

const DEFAULT_TESTBED = process.env.OPENCLAW_PYATS_TESTBED ?? "/root/.openclaw/testbed.yaml";
const PYTHON = "/opt/pyats/bin/python3";

export type PyAtsRequest = Record<string, unknown>;

export type PyAtsResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Run a pyATS Python script, passing `request` as JSON on stdin and
 * parsing the JSON response from stdout.
 *
 * Uses spawn + explicit stdin.end() rather than execFile({ input }) because
 * execFile's input option does not reliably close stdin on Node 22 — the child
 * process hangs indefinitely waiting for EOF.
 */
export async function spawnPyAts<T>(
  script: string,
  request: PyAtsRequest,
  timeoutMs = 60_000,
): Promise<PyAtsResponse<T>> {
  const scriptPath = path.join(SCRIPTS_DIR, script);
  const input = JSON.stringify(request);

  return new Promise((resolve) => {
    const child = spawn(PYTHON, [scriptPath]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ ok: false, error: `pyATS script timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    // Cap buffer at 10 MB — Genie output can be large
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 10 * 1024 * 1024) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (!stdout.trim()) {
        resolve({ ok: false, error: stderr.trim() || "pyATS script produced no output" });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as { error?: string } & T;
        if ("error" in result && typeof result.error === "string") {
          resolve({ ok: false, error: result.error });
        } else {
          resolve({ ok: true, data: result as T });
        }
      } catch {
        resolve({ ok: false, error: `Failed to parse pyATS output: ${stdout.slice(0, 200)}` });
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Resolve the testbed path from plugin config, env var, or default. */
export function resolveTestbedPath(pluginConfig?: Record<string, unknown>): string {
  if (typeof pluginConfig?.testbedPath === "string" && pluginConfig.testbedPath.trim()) {
    return pluginConfig.testbedPath.trim();
  }
  return DEFAULT_TESTBED;
}

/** Resolve the default device name from plugin config, DEVICE_HOSTNAME env var, or "primary". */
export function resolveDefaultDevice(pluginConfig?: Record<string, unknown>): string {
  if (typeof pluginConfig?.defaultDevice === "string" && pluginConfig.defaultDevice.trim()) {
    return pluginConfig.defaultDevice.trim();
  }
  const envHostname = process.env["DEVICE_HOSTNAME"]?.trim();
  if (envHostname) return envHostname;
  return "primary";
}

/** Resolve timeout from plugin config or fall back to the given default. */
export function resolveTimeoutMs(
  pluginConfig?: Record<string, unknown>,
  defaultSeconds = 60,
): number {
  const configured = pluginConfig?.timeoutSeconds;
  if (typeof configured === "number" && configured > 0) {
    return configured * 1000;
  }
  return defaultSeconds * 1000;
}
