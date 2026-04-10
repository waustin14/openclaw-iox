#!/usr/bin/env python3
"""Run a ping from a device via pyATS.

Reads a JSON request from stdin, writes a JSON result to stdout.

Input:
  {
    "testbed": "<path>",
    "target": "<ip-or-hostname>",
    "count": 5,           (optional, default 5)
    "source": "<iface>",  (optional)
    "vrf": "<vrf>",       (optional)
    "device": "<name>"    (optional, default "primary")
  }

Output (success):
  { "raw": "<ping output>", "success_rate": <0-100> | null }

Output (error):
  { "error": "<message>" }
"""
import json
import re
import sys


def parse_success_rate(output: str) -> int | None:
    """Extract success rate percentage from IOS XE ping output."""
    match = re.search(r"Success rate is (\d+) percent", output)
    if match:
        return int(match.group(1))
    return None


def main() -> None:
    req = json.loads(sys.stdin.read())
    testbed_path: str = req["testbed"]
    target: str = req["target"]
    count: int = int(req.get("count", 5))
    source: str | None = req.get("source")
    vrf: str | None = req.get("vrf")
    device_name: str = req.get("device", "primary")

    from pyats.topology import loader  # type: ignore

    testbed = loader.load(testbed_path)

    if device_name not in testbed.devices:
        device = next(iter(testbed.devices.values()))
    else:
        device = testbed.devices[device_name]

    device.connect(log_stdout=False, init_exec_commands=[], init_config_commands=[])
    try:
        # Build ping command — use raw execute for maximum IOS XE compatibility
        cmd = f"ping {target} repeat {count}"
        if source:
            cmd += f" source {source}"
        if vrf:
            cmd += f" vrf {vrf}"

        raw: str = device.execute(cmd)
        success_rate = parse_success_rate(raw)
        print(json.dumps({"raw": raw, "success_rate": success_rate}))
    finally:
        try:
            device.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
