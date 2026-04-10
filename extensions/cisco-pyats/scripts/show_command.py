#!/usr/bin/env python3
"""Run a show command on a device via pyATS/Genie.

Reads a JSON request from stdin, writes a JSON result to stdout.

Input:
  { "testbed": "<path>", "command": "<show ...>", "device": "<name>" }

Output (success):
  { "parsed": {...} | null, "raw": "<output>" | null }

Output (error):
  { "error": "<message>" }
"""
import json
import sys


def main() -> None:
    req = json.loads(sys.stdin.read())
    testbed_path: str = req["testbed"]
    command: str = req["command"]
    device_name: str = req.get("device", "primary")

    # Import here so import errors surface as JSON error responses
    from pyats.topology import loader  # type: ignore

    testbed = loader.load(testbed_path)

    if device_name not in testbed.devices:
        # Fall back to first device if alias lookup fails
        device = next(iter(testbed.devices.values()))
    else:
        device = testbed.devices[device_name]

    device.connect(log_stdout=False, init_exec_commands=[], init_config_commands=[])
    try:
        # Attempt Genie structured parse first; fall back to raw execute
        try:
            parsed = device.parse(command)
            print(json.dumps({"parsed": parsed, "raw": None}, default=str))
        except Exception:
            raw: str = device.execute(command)
            print(json.dumps({"parsed": None, "raw": raw}))
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
