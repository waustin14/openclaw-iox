import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { createPyAtsConfigureTool } from "./src/tools/pyats-configure.js";
import { createPyAtsLearnTool } from "./src/tools/pyats-learn.js";
import { createPyAtsPingTool } from "./src/tools/pyats-ping.js";
import { createPyAtsShowTool } from "./src/tools/pyats-show.js";

export default definePluginEntry({
  id: "cisco-pyats",
  name: "Cisco pyATS",
  description:
    "Agent tools for interacting with Cisco IOS XE devices via pyATS and Genie: " +
    "run show commands, push configuration, learn feature state, and test reachability.",
  register(api) {
    api.registerTool(createPyAtsShowTool(api) as AnyAgentTool);
    api.registerTool(createPyAtsConfigureTool(api) as AnyAgentTool);
    api.registerTool(createPyAtsLearnTool(api) as AnyAgentTool);
    api.registerTool(createPyAtsPingTool(api) as AnyAgentTool);
  },
});
