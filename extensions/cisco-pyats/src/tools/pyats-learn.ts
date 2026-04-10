import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import {
  resolveDefaultDevice,
  resolveTestbedPath,
  resolveTimeoutMs,
  spawnPyAts,
} from "../spawn-pyats.js";

const KNOWN_FEATURES = [
  "acl",
  "arp",
  "bgp",
  "cdp",
  "eigrp",
  "hsrp",
  "interface",
  "lldp",
  "mcast",
  "mpls",
  "ntp",
  "ospf",
  "platform",
  "routing",
  "vlan",
  "vrf",
] as const;

const schema = Type.Object(
  {
    feature: Type.Unsafe<string>({
      type: "string",
      enum: KNOWN_FEATURES,
      description:
        "Genie feature to learn. Returns a structured snapshot of that feature's " +
        "operational state. Common choices: interface (all interface state), " +
        "bgp (BGP peers and prefixes), ospf (OSPF neighbors and LSAs), " +
        "routing (RIB), vlan (VLAN database), platform (hardware/software details), " +
        "arp (ARP table), lldp/cdp (neighbor discovery).",
    }),
    device: Type.Optional(
      Type.String({
        description: "Device name in the testbed to target. Defaults to the configured default device.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createPyAtsLearnTool(api: OpenClawPluginApi) {
  const pluginConfig = api.pluginConfig;

  return {
    name: "pyats_learn",
    label: "pyATS Learn Feature",
    description:
      "Use Genie to learn a full structured snapshot of a feature on the connected " +
      "Cisco device (e.g. all interface state, the full routing table, BGP peers). " +
      "Returns deeply structured JSON — ideal for baselining, change detection, " +
      "and feeding into analysis. For targeted inspection prefer pyats_show.",
    parameters: schema,

    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const feature = readStringParam(rawParams, "feature", { required: true })!;
      const device = readStringParam(rawParams, "device") ?? resolveDefaultDevice(pluginConfig);

      const result = await spawnPyAts<{ feature: string; data: unknown }>(
        "learn_feature.py",
        {
          testbed: resolveTestbedPath(pluginConfig),
          feature,
          device,
        },
        resolveTimeoutMs(pluginConfig, 120),
      );

      if (!result.ok) {
        return jsonResult({ error: result.error, feature, device });
      }

      return jsonResult({ device, ...result.data });
    },
  };
}
