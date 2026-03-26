import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { webexPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(webexPlugin);
