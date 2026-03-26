---
summary: "Running OpenClaw inside the IOS XE Guest Shell and configuring Cisco devices for Webex messaging, syslog ingestion, and Model-Driven Telemetry"
read_when:
  - Setting up OpenClaw on a Cisco IOS XE device
  - Configuring a device to send syslog to OpenClaw
  - Enabling Webex messaging from a network device
  - Using the cisco-cli-python skill inside the Guest Shell
  - Setting up Model-Driven Telemetry with OpenClaw
title: "Cisco IOS XE (Platform)"
---

# OpenClaw on Cisco IOS XE

This guide covers running OpenClaw inside the IOS XE **Guest Shell** container and the device-side configurations required to enable all three provided integrations:

- [Webex channel](#webex-channel) — bidirectional messaging via Cisco Webex Bot API
- [Cisco Syslog channel](#cisco-syslog-channel) — inbound syslog and Model-Driven Telemetry
- [Cisco CLI Python skill](#cisco-cli-python-skill) — on-box CLI automation from within the Guest Shell

---

## Guest Shell overview

The IOS XE **Guest Shell** is a Linux container (CentOS-based) embedded in IOS XE 16.5+. It runs alongside the IOS XE control plane and has direct access to the device's Python environment and the `cli` module, which lets scripts issue CLI commands without SSH.

OpenClaw can run inside the Guest Shell as either:

- A **persistent gateway** (started via an EEM applet or `guestshell run` at boot)
- A **script executor** invoked on demand by EEM or manually

---

## 1. Enable and configure the Guest Shell

### 1.1 Reserve resources

Guest Shell requires dedicated CPU and memory. Add these to the IOS XE config before enabling:

```
app-hosting appid guestshell
 app-resource profile custom
  cpu 800
  memory 256
 !
 app-vnic management guest-interface 0
!
```

Adjust `cpu` (units out of 10000) and `memory` (MB) to match your platform's limits. Catalyst 9000 series supports higher values; ISR/ASR platforms vary.

### 1.2 Enable Guest Shell

```
guestshell enable
```

Verify it started:

```
show app-hosting list
```

Expected output includes `guestshell` with state `RUNNING`.

### 1.3 Access the Guest Shell

```
guestshell run bash
```

Or execute a single command without entering an interactive shell:

```
guestshell run python3 /flash/scripts/my_script.py
```

---

## 2. Guest Shell networking

The Guest Shell needs network access to reach the Webex API and, optionally, external npm/PyPI registries during install.

### 2.1 VirtualPortGroup and NAT (recommended for internet access)

On ISR/ASR platforms, use a VirtualPortGroup to bridge the container to a routed interface:

```
interface VirtualPortGroup0
 ip address 192.168.35.1 255.255.255.0
 ip nat inside
 ip virtual-reassembly
!
interface GigabitEthernet0/0/0
 ip nat outside
!
ip nat inside source list GS_NAT_ACL interface GigabitEthernet0/0/0 overload
!
ip access-list standard GS_NAT_ACL
 permit 192.168.35.0 0.0.0.255
!
app-hosting appid guestshell
 app-vnic gateway0 virtualportgroup 0 guest-interface 0
  guest-ipaddress 192.168.35.2 netmask 255.255.255.0
 !
 app-default-gateway 192.168.35.1 guest-interface 0
 name-server0 8.8.8.8
!
```

On Catalyst 9000 with a management VRF, the `management guest-interface 0` applet is simpler and uses the management port directly.

### 2.2 Verify connectivity from the Guest Shell

```
guestshell run curl -s https://webexapis.com/v1/people/me -o /dev/null -w "%{http_code}"
```

A `401` response (unauthorized) confirms HTTPS reachability to Webex. A `000` means no route.

---

## 3. Install Node.js and OpenClaw in the Guest Shell

### 3.1 Install Node.js

IOS XE Guest Shell ships with Python 3 but not Node.js. Install it from the NodeSource repository or a bundled tarball.

**Option A — download a pre-built tarball (recommended for air-gapped or restricted environments):**

```bash
# Inside guestshell bash
cd /flash
curl -LO https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz
tar -xf node-v22.12.0-linux-x64.tar.xz -C /usr/local --strip-components=1
node --version   # should print v22.x.x
npm --version
```

**Option B — use the package manager (requires yum/internet access):**

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs
```

### 3.2 Install OpenClaw

```bash
npm install -g openclaw
openclaw --version
```

If npm global installs go to a path not in `$PATH`, add this to `/etc/profile.d/openclaw.sh`:

```bash
export PATH="/usr/local/lib/node_modules/.bin:$PATH"
```

### 3.3 Run initial setup

```bash
openclaw setup
```

Follow the prompts to configure your AI provider and the channels you want to enable.

### 3.4 Persist the gateway across reloads using EEM

Create an EEM applet that starts the gateway after the Guest Shell initializes:

```
event manager applet OPENCLAW_GATEWAY
 event syslog pattern "guestshell.*RUNNING"
 action 1.0 cli command "enable"
 action 2.0 cli command "guestshell run nohup openclaw gateway run --bind loopback --port 18789 > /flash/openclaw-gateway.log 2>&1 &"
```

Check the log after a reload:

```
guestshell run tail -n 50 /flash/openclaw-gateway.log
```

---

## 4. Webex channel

The Webex channel uses the [Webex Bot API](https://developer.webex.com/docs/bots). The bot sends and receives messages via an HTTP webhook that Webex calls when a message is posted to a space the bot is in.

### 4.1 Create a Webex bot

1. Go to [developer.webex.com](https://developer.webex.com) and sign in.
2. Navigate to **My Apps** > **Create a New App** > **Create a Bot**.
3. Give the bot a name, username, and icon.
4. Copy the **Bot Access Token** shown after creation. This is only displayed once.

### 4.2 Make the OpenClaw gateway reachable from the internet

Webex's servers must be able to POST to your gateway's webhook URL. Options:

**Option A — public IP with port forwarding:**

Forward an external HTTPS port to port `18789` on the device's management or data-plane IP. Then set `webhookUrl` to `https://<your-public-ip>:<port>/_gateway/http/webex/<accountId>`.

**Option B — reverse proxy / tunnel (ngrok, Cloudflare Tunnel):**

From inside the Guest Shell:

```bash
# ngrok example
ngrok http 18789
# Tunnel URL: https://abc123.ngrok.io
```

Use the resulting URL as your `webhookUrl`.

**Option C — VPS relay:**

Run a lightweight reverse proxy on a VPS that forwards to the device. See [VPS setup](/vps) for a reference configuration.

### 4.3 Configure the Webex channel

```json5
{
  channels: {
    webex: {
      enabled: true,
      botToken: "YOUR_BOT_ACCESS_TOKEN",
      webhookUrl: "https://your-gateway-host/_gateway/http/webex/default",
      webhookSecret: "a-random-secret-string",
      dmPolicy: "pairing",
      allowFrom: []
    }
  }
}
```

| Key | Description |
|---|---|
| `botToken` | Bot Access Token from developer.webex.com |
| `webhookUrl` | Publicly reachable HTTPS URL for this gateway |
| `webhookSecret` | Shared secret used to verify Webex webhook signatures (recommended) |
| `dmPolicy` | `pairing` (default), `open`, `allowlist`, or `disabled` |
| `allowFrom` | List of Webex person emails or IDs allowed to message the bot |

Install the plugin and restart:

```bash
openclaw plugins install ./extensions/webex
openclaw gateway restart
```

### 4.4 Required firewall rules

Webex webhook events originate from Cisco's cloud. Allow inbound HTTPS (TCP 443) from:

```
144.254.0.0/16
64.68.96.0/19
173.39.224.0/19
```

Outbound, the gateway needs HTTPS access to `webexapis.com` (TCP 443).

### 4.5 Verify

```bash
openclaw channels status --probe webex
```

A successful probe prints the bot's display name and ID. On first message, the bot will issue a pairing challenge if `dmPolicy` is `pairing`.

---

## 5. Cisco Syslog channel

The Syslog channel opens a UDP (and optionally TCP) listener on the gateway host and routes parsed syslog events to the agent as inbound messages.

### 5.1 Configure syslog forwarding on the device

**UDP (default, port 5514):**

```
logging host <gateway-ip> transport udp port 5514
```

**TCP (optional, more reliable delivery):**

```
logging host <gateway-ip> transport tcp port 5514
```

Replace `<gateway-ip>` with the IP address reachable from the device — either the Guest Shell host IP or an external address if the gateway is running elsewhere.

**Set minimum severity to forward (optional):**

```
logging trap notifications
```

IOS XE severity levels: `emergencies(0)`, `alerts(1)`, `critical(2)`, `errors(3)`, `warnings(4)`, `notifications(5)`, `informational(6)`, `debugging(7)`. The `notifications` trap level (5) matches the plugin's default `minSeverity` of 5.

**Enable timestamps on log messages:**

```
service timestamps log datetime msec localtime show-timezone
```

**Recommended facility settings:**

```
logging facility local7
logging buffered 16384 notifications
logging console notifications
```

### 5.2 Configure the Syslog channel

```json5
{
  channels: {
    "cisco-syslog": {
      enabled: true,
      udpPort: 5514,
      tcpPort: 5514,
      bindAddress: "0.0.0.0",
      minSeverity: 5,
      allowFrom: ["192.168.1.0/24"],
      dedupeWindowSec: 30
    }
  }
}
```

| Key | Description | Default |
|---|---|---|
| `udpPort` | UDP port for syslog datagrams | `5514` |
| `tcpPort` | TCP port (RFC 6587); omit to disable | — |
| `bindAddress` | Interface to listen on | `0.0.0.0` |
| `minSeverity` | Drop messages above this severity (0=emerg, 7=debug) | `5` |
| `allowFrom` | Source IPs to accept; empty = accept all | `[]` |
| `dedupeWindowSec` | Suppress identical messages within this window | `30` |

Install the plugin and restart:

```bash
openclaw plugins install ./extensions/cisco-syslog
openclaw gateway restart
```

> **Note on port 514:** The standard syslog port is 514/UDP, but ports below 1024 require root privileges. Use port 5514 (or any port above 1023) unless the gateway process runs as root. On the device side, `transport udp port 5514` directs traffic to the correct port.

### 5.3 Model-Driven Telemetry (MDT) over HTTP

IOS XE 16.10+ supports streaming telemetry to an HTTP/JSON collector. Enable the telemetry HTTP receiver in the plugin config:

```json5
{
  channels: {
    "cisco-syslog": {
      enabled: true,
      telemetryHttpPort: 9900
    }
  }
}
```

Configure the device to stream to the gateway:

```
telemetry ietf subscription 101
 encoding encode-kvgpb
 filter xpath /process-cpu-ios-xe-oper:cpu-usage/cpu-utilization/five-seconds
 source-address <device-loopback-ip>
 stream yang-push
 update-policy periodic 6000
 receiver ip address <gateway-ip> 9900 protocol grpc-tcp
!
```

For dial-out HTTP/JSON (supported on some platforms):

```
telemetry receiver protocol 101
 host name <gateway-hostname> 9900
 protocol http2-clear
!
```

Telemetry payloads are delivered to `POST /telemetry` on the configured port and forwarded to the agent with a summary message including the node ID, encoding path, and collection ID.

### 5.4 Verify

```bash
openclaw channels status --probe cisco-syslog
```

Send a test syslog message from the device:

```
send log "OpenClaw syslog test message"
```

---

## 6. Cisco CLI Python skill

The `cisco-cli-python` skill teaches the agent to run Python scripts inside the Guest Shell using the built-in `cli` module — no SSH credentials required.

### 6.1 How it works

The `cli` module is available by default inside the IOS XE Guest Shell. Scripts import it with `import cli` and call functions like `cli.cli("show ip interface brief")` to execute device commands and receive the output as a string.

The agent can generate and run these scripts to:

- Inspect interface, routing, BGP, or ACL state
- Apply and verify configuration changes
- Parse `show logging` output for recent errors
- Extract device version and serial information

### 6.2 Enabling script execution from the Guest Shell

Ensure the Guest Shell can write and execute scripts in a persistent location:

```bash
# Inside guestshell bash
mkdir -p /flash/openclaw-scripts
chmod 755 /flash/openclaw-scripts
```

The agent writes generated scripts to this directory and executes them via `guestshell run python3 /flash/openclaw-scripts/<script>.py`.

### 6.3 Required IOS XE privilege level

Scripts run as the Guest Shell Linux user, which maps to IOS XE privilege level 15 by default. If your device uses a restricted guest shell policy, verify that `guestshell run` is permitted for the gateway process user:

```
aaa authorization exec default local
username guestshell privilege 15 secret <password>
```

### 6.4 Installing additional Python packages

If the agent needs `genie`/`pyATS` or `netmiko` for structured parsing or remote device access, install them inside the Guest Shell:

```bash
pip3 install pyats[full]
pip3 install netmiko
```

For air-gapped environments, download wheels on a connected host and copy them to `/flash/`:

```bash
# On a connected host
pip3 download pyats[full] -d /tmp/pyats-wheels

# Copy to device flash (via SCP or USB)
# Then inside guestshell:
pip3 install --no-index --find-links /flash/pyats-wheels pyats[full]
```

### 6.5 EEM integration

To have the agent respond automatically to specific syslog events (for example, running a diagnostic when an interface goes down), combine the Syslog channel with an EEM applet:

```
event manager applet INTF_DOWN_ALERT
 event syslog pattern "%LINK-3-UPDOWN.*down"
 action 1.0 syslog msg "OpenClaw: interface down event detected"
```

The Syslog channel forwards the `%LINK-3-UPDOWN` message to the agent, which can then invoke the `cisco-cli-python` skill to run diagnostics and report results back via the Webex channel.

---

## 7. Summary of required device configurations

| Feature | Minimum IOS XE version | Key config |
|---|---|---|
| Guest Shell | 16.5 | `guestshell enable` |
| Guest Shell networking | 16.5 | VirtualPortGroup + NAT or management VRF |
| Webex channel | 16.5 (for Guest Shell) | `logging host` not needed; requires public webhook URL |
| Syslog channel | Any | `logging host <ip> transport udp port 5514` |
| MDT over HTTP | 16.10 | `telemetry ietf subscription` + receiver config |
| CLI Python skill | 16.5 | Guest Shell enabled; `import cli` available by default |
