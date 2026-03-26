import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { ciscoSyslogPlugin } from "./src/channel.js";
import { setCiscoSyslogRuntime } from "./src/runtime.js";

export { ciscoSyslogPlugin } from "./src/channel.js";
export { setCiscoSyslogRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "cisco-syslog",
  name: "Cisco Syslog",
  description: "Cisco syslog and Model-Driven Telemetry receiver channel plugin",
  plugin: ciscoSyslogPlugin,
  setRuntime: setCiscoSyslogRuntime,
});
