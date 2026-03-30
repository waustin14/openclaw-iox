import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import {
  resolveDefaultDevice,
  resolveTestbedPath,
  resolveTimeoutMs,
  spawnPyAts,
} from "../spawn-pyats.js";

const schema = Type.Object(
  {
    command: Type.String({
      description:
        'IOS XE show command to run (e.g. "show interfaces", "show ip bgp summary", "show version"). ' +
        "Genie will attempt a structured parse; raw output is returned as a fallback.",
    }),
    device: Type.Optional(
      Type.String({
        description:
          "Device name in the testbed to target. Defaults to the configured default device.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createPyAtsShowTool(api: OpenClawPluginApi) {
  const pluginConfig = api.pluginConfig;

  return {
    name: "pyats_show",
    label: "pyATS Show Command",
    description:
      "Run a show command on the connected Cisco device via pyATS. " +
      "Returns Genie-parsed structured output when a parser is available, " +
      "otherwise returns the raw command output. " +
      "Use this to inspect interface state, routing tables, BGP neighbors, " +
      "platform details, ACLs, and any other operational data.",
    parameters: schema,

    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const command = readStringParam(rawParams, "command", { required: true })!;
      const device = readStringParam(rawParams, "device") ?? resolveDefaultDevice(pluginConfig);

      const result = await spawnPyAts<{ parsed: unknown; raw: string | null }>(
        "show_command.py",
        {
          testbed: resolveTestbedPath(pluginConfig),
          command,
          device,
        },
        resolveTimeoutMs(pluginConfig, 60),
      );

      if (!result.ok) {
        return jsonResult({ error: result.error, command, device });
      }

      return jsonResult({ command, device, ...result.data });
    },
  };
}
