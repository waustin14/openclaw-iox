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
    commands: Type.Array(Type.String(), {
      description:
        "List of IOS XE configuration lines to apply (do not include 'conf t' or 'end' — " +
        "pyATS handles entering and exiting config mode automatically). " +
        'Example: ["interface GigabitEthernet0/0", "description uplink", "no shutdown"]',
      minItems: 1,
    }),
    device: Type.Optional(
      Type.String({
        description: "Device name in the testbed to target. Defaults to the configured default device.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createPyAtsConfigureTool(api: OpenClawPluginApi) {
  const pluginConfig = api.pluginConfig;

  return {
    name: "pyats_configure",
    label: "pyATS Configure Device",
    description:
      "Push IOS XE configuration lines to the connected Cisco device via pyATS. " +
      "Automatically enters and exits configuration mode. " +
      "Use this to apply interface settings, routing changes, ACLs, " +
      "or any other configuration. Always verify with pyats_show after applying changes.",
    parameters: schema,

    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const device = readStringParam(rawParams, "device") ?? resolveDefaultDevice(pluginConfig);
      const commands = rawParams.commands as string[];

      const result = await spawnPyAts<{ output: string }>(
        "configure.py",
        {
          testbed: resolveTestbedPath(pluginConfig),
          commands,
          device,
        },
        resolveTimeoutMs(pluginConfig, 120),
      );

      if (!result.ok) {
        return jsonResult({ error: result.error, commands, device });
      }

      return jsonResult({ commands, device, output: result.data.output });
    },
  };
}
