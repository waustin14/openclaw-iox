#!/usr/bin/env python3
"""Push configuration lines to a device via pyATS.

Reads a JSON request from stdin, writes a JSON result to stdout.

Input:
  { "testbed": "<path>", "commands": ["<line1>", ...], "device": "<name>" }

Output (success):
  { "output": "<configure output>" }

Output (error):
  { "error": "<message>" }
"""
import json
import sys


def main() -> None:
    req = json.loads(sys.stdin.read())
    testbed_path: str = req["testbed"]
    commands: list[str] = req["commands"]
    device_name: str = req.get("device", "primary")

    from pyats.topology import loader  # type: ignore

    testbed = loader.load(testbed_path)

    if device_name not in testbed.devices:
        device = next(iter(testbed.devices.values()))
    else:
        device = testbed.devices[device_name]

    device.connect(log_stdout=False, init_exec_commands=[], init_config_commands=[])
    try:
        output: str = device.configure(commands)
        print(json.dumps({"output": output}))
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
