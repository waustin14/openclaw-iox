import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-api.js";

const { setRuntime: setCiscoSyslogRuntime, getRuntime: getCiscoSyslogRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Cisco Syslog runtime not initialized");

export { getCiscoSyslogRuntime, setCiscoSyslogRuntime };
