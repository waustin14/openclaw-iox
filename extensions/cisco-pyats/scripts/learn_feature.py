#!/usr/bin/env python3
"""Learn a Genie feature from a device (structured state snapshot).

Reads a JSON request from stdin, writes a JSON result to stdout.

Input:
  { "testbed": "<path>", "feature": "<feature>", "device": "<name>" }

  Common features: interface, bgp, ospf, eigrp, hsrp, vlan, arp,
                   routing, lldp, platform, acl, ntp, cdp

Output (success):
  { "feature": "<name>", "data": {...} }

Output (error):
  { "error": "<message>" }
"""
import json
import sys


def main() -> None:
    req = json.loads(sys.stdin.read())
    testbed_path: str = req["testbed"]
    feature: str = req["feature"]
    device_name: str = req.get("device", "primary")

    from pyats.topology import loader  # type: ignore

    testbed = loader.load(testbed_path)

    if device_name not in testbed.devices:
        device = next(iter(testbed.devices.values()))
    else:
        device = testbed.devices[device_name]

    device.connect(log_stdout=False, init_exec_commands=[], init_config_commands=[])
    try:
        learned = device.learn(feature)
        data = learned.to_dict() if hasattr(learned, "to_dict") else vars(learned)
        print(json.dumps({"feature": feature, "data": data}, default=str))
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
