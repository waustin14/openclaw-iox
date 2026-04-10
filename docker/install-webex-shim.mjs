#!/usr/bin/env node
// Installs the webex plugin-sdk shim into the globally installed openclaw package.
// Skips if the installed version already ships dist/plugin-sdk/webex.js.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Find the globally installed openclaw package root via npm.
const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const pkgRoot = path.join(npmRoot, "openclaw");
const pkgPath = path.join(pkgRoot, "package.json");
const distTarget = path.join(pkgRoot, "dist", "plugin-sdk", "webex.js");

// If the real barrel already exists, nothing to do.
if (fs.existsSync(distTarget)) {
  console.log("dist/plugin-sdk/webex.js already exists — shim not needed.");
  process.exit(0);
}

// 1. Add exports entry to package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!pkg.exports["./plugin-sdk/webex"]) {
  pkg.exports["./plugin-sdk/webex"] = {
    types: "./dist/plugin-sdk/src/plugin-sdk/webex.d.ts",
    default: "./dist/plugin-sdk/webex.js",
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Added ./plugin-sdk/webex to openclaw package.json exports.");
}

// 2. Copy the shim into place
const shimSrc = path.join(path.dirname(new URL(import.meta.url).pathname), "plugin-sdk-webex-shim.js");
fs.copyFileSync(shimSrc, distTarget);
console.log(`Installed webex shim at ${distTarget}`);
