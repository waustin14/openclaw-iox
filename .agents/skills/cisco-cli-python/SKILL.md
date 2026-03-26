---
name: cisco-cli-python
description: Skill for using Cisco's CLI Python modules (cisco.cli, genie/pyATS) to interact with IOS XE, IOS XR, NX-OS, and other Cisco network devices. Use when the user wants to run CLI commands on a Cisco device, parse structured output, automate configuration changes, or troubleshoot network issues via Python.
---

# Cisco CLI Python

Use this skill when asked to interact with Cisco network devices programmatically via Python.

## Which module to use

| Scenario | Module |
|---|---|
| IOS XE guest shell (`cisco_cli` built-in) | `cisco.cli` |
| Full multi-device automation, structured parsing | `genie` / `pyATS` |
| Simple SSH/Telnet scripting | `netmiko` |
| Direct NETCONF/YANG | `ncclient` |

---

## 1. `cisco.cli` — IOS XE Guest Shell

`cisco.cli` ships inside the IOS XE Guest Shell and requires no installation.

### Import

```python
import cli
```

### Functions

| Function | Description | Returns |
|---|---|---|
| `cli.cli(cmd)` | Run a show/exec command, return raw output | `str` |
| `cli.clip(cmd)` | Run a show/exec command, print to stdout | `None` |
| `cli.configure(cmds)` | Apply config commands (list or newline-separated string) | `str` |
| `cli.configurep(cmds)` | Apply config commands and print output | `None` |
| `cli.execute(cmd)` | Run exec command without output capture | `str` |

### Examples

```python
import cli

# Show running config
output = cli.cli("show running-config")
print(output)

# Show IP interfaces brief
output = cli.cli("show ip interface brief")

# Show version
output = cli.cli("show version")

# Show BGP summary
output = cli.cli("show bgp ipv4 unicast summary")

# Configure a loopback
cli.configure("""
interface Loopback100
 description Managed by OpenClaw
 ip address 192.0.2.1 255.255.255.255
 no shutdown
""")

# Multiple config commands as a list
cli.configure([
    "interface GigabitEthernet1",
    " description WAN uplink",
    " no shutdown",
])
```

### Error handling

```python
import cli

try:
    output = cli.cli("show bgp neighbors")
except Exception as e:
    print(f"CLI error: {e}")
```

---

## 2. `genie` / `pyATS` — Structured Parsing & Multi-Device

Install with `pip install pyats genie`.

### Connect to a device

```python
from pyats.topology import loader

# Load from testbed YAML
testbed = loader.load("testbed.yaml")
device = testbed.devices["router1"]
device.connect()
```

### Minimal testbed.yaml

```yaml
devices:
  router1:
    os: iosxe
    type: router
    connections:
      defaults:
        class: unicon.Unicon
      cli:
        protocol: ssh
        ip: 192.168.1.1
        port: 22
    credentials:
      default:
        username: admin
        password: secret
```

### Parse structured output

```python
# Parse "show interfaces" into a dict
parsed = device.parse("show interfaces")
# parsed["GigabitEthernet1"]["oper_status"] → "up"

# Parse "show ip route"
routes = device.parse("show ip route")

# Parse "show bgp all summary"
bgp_summary = device.parse("show bgp all summary")

# Parse "show version"
version_info = device.parse("show version")
platform = version_info["version"]["platform"]
```

### Execute commands

```python
# Raw CLI output
output = device.execute("show logging last 50")

# Configure
device.configure("""
logging buffered 16384 debugging
logging host 10.0.0.100
""")
```

### Learn operational state

```python
# Learn full interface state (returns Python objects)
interfaces = device.learn("interface")
for name, intf in interfaces.info.items():
    print(f"{name}: oper={intf.get('oper_status')}")
```

### Common parsed models by platform

| Command | genie.libs parser |
|---|---|
| `show interfaces` | `show_interfaces` |
| `show ip interface brief` | `show_ip_interface_brief` |
| `show ip route` | `show_ip_route` |
| `show bgp all summary` | `show_bgp_all_summary` |
| `show version` | `show_version` |
| `show cdp neighbors detail` | `show_cdp_neighbors_detail` |
| `show logging` | `show_logging` |
| `show access-lists` | `show_access_lists` |

---

## 3. `netmiko` — SSH/Telnet Scripting

Install with `pip install netmiko`.

```python
from netmiko import ConnectHandler

device = {
    "device_type": "cisco_ios",  # or cisco_iosxr, cisco_nxos
    "host": "192.168.1.1",
    "username": "admin",
    "password": "secret",
    "secret": "enable_secret",  # for enable mode
}

with ConnectHandler(**device) as net_connect:
    # Show command
    output = net_connect.send_command("show ip interface brief")
    print(output)

    # Config change
    config_commands = [
        "interface Loopback0",
        " description OpenClaw managed",
    ]
    net_connect.send_config_set(config_commands)

    # Save config
    net_connect.save_config()
```

---

## 4. Common Patterns

### Parse syslog-style output from `show logging`

```python
import cli
import re

output = cli.cli("show logging")
# Extract %LINK-3-UPDOWN messages
errors = [line for line in output.splitlines() if "%LINK-3-UPDOWN" in line or "%SYS-5-CONFIG_I" in line]
for err in errors[-10:]:
    print(err)
```

### Check interface states

```python
import cli

output = cli.cli("show ip interface brief")
down_interfaces = []
for line in output.splitlines():
    parts = line.split()
    if len(parts) >= 6 and parts[4] == "down":
        down_interfaces.append(parts[0])
print("Down interfaces:", down_interfaces)
```

### Apply and verify a configuration change

```python
import cli

# Apply change
cli.configure("ip route 0.0.0.0 0.0.0.0 10.0.0.1")

# Verify
output = cli.cli("show ip route 0.0.0.0")
if "0.0.0.0/0" in output:
    print("Default route installed successfully")
else:
    print("WARNING: default route not found in routing table")
```

### Get device serial / version info (IOS XE guest shell)

```python
import cli
import re

output = cli.cli("show version")
serial_match = re.search(r"Processor board ID\s+(\S+)", output)
if serial_match:
    print("Serial:", serial_match.group(1))
version_match = re.search(r"Cisco IOS XE Software.*Version\s+(\S+)", output)
if version_match:
    print("Version:", version_match.group(1))
```

---

## 5. Running scripts from OpenClaw

When the agent receives a request to run CLI commands on the device, use the appropriate module:

- **On-box (guest shell)**: Use `cisco.cli` — no SSH needed, runs directly on the device
- **Remote device**: Use `netmiko` or `pyATS` with the device's SSH credentials

Always handle exceptions and return structured output (dicts or formatted strings) so the agent can interpret and relay results clearly.
