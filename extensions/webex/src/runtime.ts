import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-api.js";

const { setRuntime: setWebexRuntime, getRuntime: getWebexRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Webex runtime not initialized");

export { getWebexRuntime, setWebexRuntime };
