---
name: cisco-pyats
description: Use pyATS and Genie tools to inspect, troubleshoot, and configure Cisco IOS XE devices connected to this OpenClaw IOx container.
---

# Cisco pyATS

Use when asked to troubleshoot, inspect, or configure the connected Cisco device.

## Available Tools

| Tool | Purpose |
|------|---------|
| `pyats_show` | Run any `show` command; returns Genie-parsed JSON when available, raw text otherwise |
| `pyats_configure` | Push IOS XE configuration lines |
| `pyats_learn` | Take a full structured snapshot of a feature (interfaces, BGP, OSPF, routing, etc.) |
| `pyats_ping` | Ping a target from the device; returns success rate |

## Approach

1. **Always start read-only.** Use `pyats_show` or `pyats_learn` before making changes.
2. **Confirm reachability first.** If the issue involves forwarding, run `pyats_ping` to establish a baseline.
3. **Prefer `pyats_show` for targeted inspection**, `pyats_learn` for a broad snapshot or baselining.
4. **After any configuration change**, verify with a relevant `pyats_show` command.

## Common Show Commands

```
show version                        — platform, IOS XE version, uptime
show interfaces                     — all interface counters and state
show interfaces <name>              — single interface detail
show ip interface brief             — IP address + line/protocol summary
show ip route                       — IPv4 routing table
show ip route <prefix>              — specific prefix lookup
show ip bgp summary                 — BGP peer states and prefix counts
show ip ospf neighbor               — OSPF adjacencies
show ip arp                         — ARP table
show cdp neighbors detail           — CDP neighbor details
show lldp neighbors detail          — LLDP neighbor details
show spanning-tree                  — STP state per VLAN
show vlan brief                     — VLAN database
show etherchannel summary           — port-channel members and state
show ip access-lists                — ACL hit counters
show logging                        — recent syslog buffer
show processes cpu sorted           — top CPU consumers
show processes memory sorted        — top memory consumers
show environment all                — hardware health (temp, fans, power)
show redundancy                     — HA/SSO state
```

## Genie Features for pyats_learn

| Feature | What it captures |
|---------|-----------------|
| `interface` | All interface operational state, counters, IP config |
| `bgp` | All BGP peers, state, prefix counts, attributes |
| `ospf` | OSPF processes, areas, neighbors, LSA database |
| `eigrp` | EIGRP neighbors and topology |
| `routing` | Full RIB (all protocols) |
| `vlan` | VLAN database and port membership |
| `arp` | ARP cache |
| `lldp` | LLDP neighbors |
| `cdp` | CDP neighbors |
| `platform` | Hardware inventory, module state |
| `acl` | All ACLs with hit counters |
| `ntp` | NTP peers and sync state |
| `hsrp` | HSRP group state and active/standby roles |

## Configuration Patterns

### Enable interface
```json
["interface GigabitEthernet1/0/1", "no shutdown"]
```

### Add description
```json
["interface GigabitEthernet1/0/1", "description uplink-to-core"]
```

### Set IP address
```json
["interface GigabitEthernet0/0", "ip address 10.0.0.1 255.255.255.0", "no shutdown"]
```

### Add static route
```json
["ip route 0.0.0.0 0.0.0.0 10.0.0.254"]
```

### Save config
```json
["do write memory"]
```

## Troubleshooting Workflows

### Interface is down
1. `pyats_show` → `show interfaces <name>` — check line/protocol state and error counters
2. `pyats_show` → `show interfaces <name>` for the remote end if accessible
3. Check `input errors`, `CRC`, `giants`, `runts` for physical layer issues
4. `pyats_configure` to `no shutdown` if administratively down

### No IP reachability
1. `pyats_ping` to the next-hop
2. `pyats_show` → `show ip route <dest>` — confirm route exists
3. `pyats_show` → `show ip arp` — confirm ARP resolves for next-hop
4. `pyats_show` → `show ip interface brief` — confirm source interface is up/up with correct IP

### BGP neighbor down
1. `pyats_show` → `show ip bgp summary` — check state and uptime
2. `pyats_ping` to BGP peer address (with source interface if needed)
3. `pyats_show` → `show ip bgp neighbors <peer>` — check error codes and hold timer
4. Check ACLs: `pyats_show` → `show ip access-lists`

### High CPU
1. `pyats_show` → `show processes cpu sorted` — identify top process
2. `pyats_show` → `show processes cpu history` — confirm it is sustained
3. `pyats_show` → `show logging` — look for related error messages

## Important Notes

- **Do not include `configure terminal` or `end`** in `pyats_configure` commands — pyATS handles config mode automatically.
- **`pyats_learn` on large devices can be slow** (10-30 seconds for `interface` or `routing`). Prefer `pyats_show` for targeted queries.
- **SSH key auth is required.** The container generates an SSH key on first start. Ensure the public key is added to the device's `openclaw` user before running tools.
- **Parsed output (`pyats_show`) may be `null`** for commands Genie does not have a parser for. The `raw` field always contains the command output.
- **Always save config** with `["do write memory"]` after changes if persistence across reloads is required.
