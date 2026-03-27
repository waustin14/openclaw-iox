---
title: "Cisco IOS XE — Custom IOx Container (pyATS)"
summary: "Build the OpenClaw Docker image, convert it to an IOx app package with ioxclient, and deploy it to a Catalyst or ISR device for advanced multi-protocol troubleshooting via pyATS."
read_when:
  - Building the OpenClaw Docker image for IOx
  - Converting a Docker image to an IOx app package
  - Deploying OpenClaw as a custom IOx container
  - Configuring pyATS SSH access to a Cisco device
  - Activating and managing the OpenClaw IOx app
---

# Cisco IOS XE — Custom IOx Container (pyATS)

This guide walks through building the OpenClaw Docker image, packaging it as an IOx app, deploying it to a Catalyst or ISR device, and configuring the device for SSH access so pyATS can reach the management plane.

Use this path instead of the [Guest Shell guide](/platforms/cisco-iox) when:

- The ~1100 MB Guest Shell storage budget is insufficient
- You need structured show-command output via pyATS/Genie
- You need to manage multiple devices from a single agent instance

---

## Prerequisites

### Developer workstation

| Tool | Version | Install |
|---|---|---|
| Docker Desktop | 24+ | [docker.com/get-started](https://www.docker.com/get-started) |
| `ioxclient` | 1.14+ | [developer.cisco.com/docs/iox](https://developer.cisco.com/docs/iox) |
| OpenSSH client | any | included on macOS/Linux; Git Bash on Windows |

Verify both tools are on your PATH:

```bash
docker --version
ioxclient --version
```

### Device requirements

| Platform | Minimum IOS XE | IOx support |
|---|---|---|
| Catalyst 9300/9400/9500 | 16.12 | Docker-based IOx apps |
| ISR 4000 series | 16.10 | Docker-based IOx apps |
| CSR 1000v / Catalyst 8000v | 16.12 | Docker-based IOx apps |
| IR1101 | 1.2 | Docker-based IOx apps (ARM) |
| IR1800 | 1.5 | Docker-based IOx apps (ARM64) |

IOx and the CAF (Cisco Application Framework) must be enabled — see [Enable IOx on the device](#enable-iox-on-the-device).

---

## Step 1 — Enable IOx on the device

```
iox
!
ip http server
ip http authentication local
ip http secure-server
```

Verify IOx is running:

```
show iox-service
```

Expected output shows `CAF` and `HA_ENV` as `Running`. If `IOx Infrastructure Summary` shows `IOx service (CAF) : Not Running`, save the config and reload.

---

## Step 2 — Build the Docker image

Clone (or pull) the repo on your workstation, then build from the repo root:

```bash
docker build \
  --platform linux/amd64 \
  -f Dockerfile.iox \
  -t openclaw-iox:latest \
  .
```

For ISR 4000 (also x86_64) use the same `linux/amd64` platform. For IR1101 substitute `linux/arm/v7`; for IR1800 use `linux/arm64`. Cross-platform builds require Docker Buildx:

```bash
docker buildx build \
  --platform linux/arm64 \
  -f Dockerfile.iox \
  -t openclaw-iox:arm64 \
  .
```

Verify the image size before proceeding — it should be under 1.5 GB:

```bash
docker image ls openclaw-iox
```

---

## Step 3 — Convert the image to an IOx package

IOx apps are distributed as `.tar` archives. `ioxclient` handles the conversion.

Create a working directory and copy the descriptor:

```bash
mkdir iox-package && cd iox-package
cp ../docker/package.yaml .
```

Run the packager:

```bash
ioxclient docker package openclaw-iox:latest . --use-targz
```

This produces `package.tar` (or `package.tar.gz` with `--use-targz`) in the current directory. The file will be roughly 600–900 MB compressed.

Verify the package is valid:

```bash
ioxclient package validate package.tar
```

---

## Step 4 — Create an activation payload

The activation payload passes environment variables (API keys, gateway config) into the container at deploy time. Create `activation.json` in the `iox-package` directory — **do not commit this file**:

```json
{
  "resources": {
    "profile": "custom",
    "cpu": 2000,
    "memory": 512,
    "disk": 4000,
    "network": [
      {
        "interface-name": "eth0",
        "network-name": "iox-nat0"
      }
    ]
  },
  "environment": {
    "OPENCLAW_GATEWAY_KEY": "replace-with-a-strong-random-string",
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENCLAW_GATEWAY_MODE": "local",
    "OPENCLAW_AGENT_ID": "cisco-agent"
  }
}
```

`iox-nat0` is the default NAT network on most IOS XE platforms. Verify the available networks on your device:

```
show iox network
```

---

## Step 5 — Deploy via ioxclient

### Configure ioxclient to point at the device

```bash
ioxclient profiles create
```

Enter the device management IP, HTTP/HTTPS port (typically 443 for HTTPS), and local manager credentials when prompted. `ioxclient` saves the profile at `~/.ioxclientcfg.yaml`.

### Install, activate, and start

```bash
# Install the package (uploads the tar to the device — may take several minutes)
ioxclient application install openclaw-iox package.tar

# Activate with the payload (applies resource limits and env vars)
ioxclient application activate openclaw-iox --payload activation.json

# Start the application
ioxclient application start openclaw-iox
```

Check status:

```bash
ioxclient application info openclaw-iox
```

Expected `state: RUNNING`. Follow the logs:

```bash
ioxclient application logs openclaw-iox --follow
```

The entrypoint will print a startup summary including the pyATS and Genie versions, confirming the Python environment is intact.

---

## Step 6 — Configure device SSH for pyATS

pyATS connects to the device over SSH from within the container. The container reaches the device via the IOx NAT interface, which typically maps to `192.168.1.x` or the management VRF address. Use the device's management IP or the VirtualPortGroup address as the pyATS target.

### Enable SSH and create a pyATS user

```
ip domain-name lab.internal
crypto key generate rsa modulus 2048
!
username pyats privilege 15 secret 0 replace-with-strong-password
!
line vty 0 15
 login local
 transport input ssh
```

Privilege 15 is required for `show` commands and configuration. If privilege 15 is a security concern, use `privilege exec level 14` to define a restricted command set.

### Verify SSH reachability from within the container

```bash
ioxclient application exec openclaw-iox -- \
  ssh -o StrictHostKeyChecking=no pyats@<device-mgmt-ip> show version
```

If the connection is refused, check that the IOx NAT network has a route to the management VRF:

```
show ip route vrf Mgmt-vrf
show iox network detail iox-nat0
```

### pyATS testbed file

Create `/root/.openclaw/testbed.yaml` inside the container (or mount it via a volume). The cisco-cli-python skill references this path by default:

```yaml
devices:
  router:
    os: iosxe
    type: router
    credentials:
      default:
        username: pyats
        password: replace-with-strong-password
    connections:
      defaults:
        class: unicon.Unicon
      cli:
        protocol: ssh
        ip: 192.168.1.1   # device management IP as seen from the container
        port: 22
```

You can write this file into the container using `ioxclient`:

```bash
ioxclient application exec openclaw-iox -- \
  bash -c "cat > /root/.openclaw/testbed.yaml" < testbed.yaml
```

---

## Step 7 — Configure device-side integrations

With the container running, apply the same device configurations documented in the [Guest Shell guide](/platforms/cisco-iox) for syslog forwarding and Model-Driven Telemetry — the only difference is the destination IP. Use the IOx container's IP address (visible in `show iox network detail`) instead of `127.0.0.1`.

Find the container IP:

```
show app-hosting detail appid openclaw-iox
```

Look for the `eth0` address in the network section. Then:

```
! Syslog
logging host <container-ip> transport udp port 5514
logging host <container-ip> transport tcp port 5514

! MDT (IOS XE 16.10+)
telemetry ietf subscription 101
 encoding encode-kvgpb
 filter xpath /process-cpu-ios-xe-oper:cpu-usage/cpu-utilization/five-seconds
 source-address <container-ip>
 stream yang-push
 update-policy periodic 6000
 receiver ip address <container-ip> 9000 protocol http
```

---

## Upgrading the app

When a new OpenClaw version is available:

```bash
# Rebuild the image with the new version
docker build --platform linux/amd64 -f Dockerfile.iox \
  --build-arg OPENCLAW_VERSION=2026.x.x \
  -t openclaw-iox:2026.x.x .

# Repackage
cd iox-package
ioxclient docker package openclaw-iox:2026.x.x . --use-targz

# Stop, upgrade, restart
ioxclient application stop openclaw-iox
ioxclient application upgrade openclaw-iox package.tar
ioxclient application start openclaw-iox
```

The persistent volume at `/root/.openclaw` is preserved across upgrades so credentials, sessions, and agent state are retained.

---

## Troubleshooting

**App stuck in `ACTIVATING`**
- Check that the `iox-nat0` network exists: `show iox network`
- Verify disk quota is available: `show app-hosting resource`
- Review CAF logs: `show logging | include CAF`

**pyATS `ConnectionError`**
- Confirm SSH reachability from inside the container (Step 6 verify step)
- Check that VTY lines accept SSH: `show line vty 0 15`
- Confirm the testbed IP matches the device's address as seen from the NAT subnet

**Container exits immediately**
- Check the entrypoint log: `ioxclient application logs openclaw-iox`
- Most common cause: `OPENCLAW_GATEWAY_KEY` is missing from `activation.json`

**`ioxclient docker package` fails with "manifest unknown"**
- Run `docker image ls openclaw-iox` — confirm the tag matches exactly
- Try `docker save openclaw-iox:latest | ioxclient package create --tar -` as an alternative

**Disk full during build**
- Run `docker system prune -f` to clear build cache before retrying
- The pyATS layer (~400 MB) and the Node.js layer (~200 MB) are the largest; each is cached independently so incremental rebuilds are fast after the first

---

## Summary

| Step | Command |
|---|---|
| Build image | `docker build --platform linux/amd64 -f Dockerfile.iox -t openclaw-iox:latest .` |
| Package for IOx | `ioxclient docker package openclaw-iox:latest . --use-targz` |
| Validate package | `ioxclient package validate package.tar` |
| Install on device | `ioxclient application install openclaw-iox package.tar` |
| Activate | `ioxclient application activate openclaw-iox --payload activation.json` |
| Start | `ioxclient application start openclaw-iox` |
| View logs | `ioxclient application logs openclaw-iox --follow` |
| Stop | `ioxclient application stop openclaw-iox` |
| Upgrade | `ioxclient application upgrade openclaw-iox package.tar` |
