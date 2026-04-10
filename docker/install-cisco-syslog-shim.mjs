#!/usr/bin/env node
// Installs the cisco-syslog plugin-sdk shim into the globally installed openclaw package.
// Skips if the installed version already ships dist/plugin-sdk/cisco-syslog.js.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Find the globally installed openclaw package root via npm.
const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const pkgRoot = path.join(npmRoot, "openclaw");
const pkgPath = path.join(pkgRoot, "package.json");
const distTarget = path.join(pkgRoot, "dist", "plugin-sdk", "cisco-syslog.js");

// If the real barrel already exists, nothing to do.
if (fs.existsSync(distTarget)) {
  console.log("dist/plugin-sdk/cisco-syslog.js already exists — shim not needed.");
  process.exit(0);
}

// 1. Add exports entry to package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!pkg.exports["./plugin-sdk/cisco-syslog"]) {
  pkg.exports["./plugin-sdk/cisco-syslog"] = {
    types: "./dist/plugin-sdk/src/plugin-sdk/cisco-syslog.d.ts",
    default: "./dist/plugin-sdk/cisco-syslog.js",
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Added ./plugin-sdk/cisco-syslog to openclaw package.json exports.");
}

// 2. Copy the shim into place
const shimSrc = path.join(path.dirname(new URL(import.meta.url).pathname), "plugin-sdk-cisco-syslog-shim.js");
fs.copyFileSync(shimSrc, distTarget);
console.log(`Installed cisco-syslog shim at ${distTarget}`);
