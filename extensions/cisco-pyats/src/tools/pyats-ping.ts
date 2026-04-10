import { Type } from "@sinclair/typebox";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import {
  resolveDefaultDevice,
  resolveTestbedPath,
  resolveTimeoutMs,
  spawnPyAts,
} from "../spawn-pyats.js";

const schema = Type.Object(
  {
    target: Type.String({
      description: "IP address or hostname to ping from the device.",
    }),
    count: Type.Optional(
      Type.Number({
        description: "Number of ping packets to send. Defaults to 5.",
        minimum: 1,
        maximum: 100,
      }),
    ),
    source: Type.Optional(
      Type.String({
        description:
          "Source interface or IP address to use for the ping " +
          '(e.g. "Loopback0" or "10.0.0.1").',
      }),
    ),
    vrf: Type.Optional(
      Type.String({
        description: "VRF name to use for the ping (e.g. \"Mgmt-vrf\").",
      }),
    ),
    device: Type.Optional(
      Type.String({
        description: "Device name in the testbed to target. Defaults to the configured default device.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createPyAtsPingTool(api: OpenClawPluginApi) {
  const pluginConfig = api.pluginConfig;

  return {
    name: "pyats_ping",
    label: "pyATS Ping",
    description:
      "Run a ping from the connected Cisco device to a target IP or hostname via pyATS. " +
      "Returns raw ping output and the parsed success rate percentage. " +
      "Useful for verifying reachability, testing specific source interfaces, " +
      "and confirming VRF routing.",
    parameters: schema,

    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const target = readStringParam(rawParams, "target", { required: true })!;
      const count = readNumberParam(rawParams, "count", { integer: true }) ?? 5;
      const source = readStringParam(rawParams, "source");
      const vrf = readStringParam(rawParams, "vrf");
      const device = readStringParam(rawParams, "device") ?? resolveDefaultDevice(pluginConfig);

      const result = await spawnPyAts<{ raw: string; success_rate: number | null }>(
        "ping_test.py",
        {
          testbed: resolveTestbedPath(pluginConfig),
          target,
          count,
          ...(source ? { source } : {}),
          ...(vrf ? { vrf } : {}),
          device,
        },
        resolveTimeoutMs(pluginConfig, 30),
      );

      if (!result.ok) {
        return jsonResult({ error: result.error, target, device });
      }

      return jsonResult({
        target,
        device,
        count,
        success_rate: result.data.success_rate,
        raw: result.data.raw,
      });
    },
  };
}
