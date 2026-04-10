#!/bin/bash
# docker/iox-entrypoint.sh — OpenClaw IOx container entrypoint
#
# Validates required env vars, applies any config passed via environment,
# then starts the OpenClaw gateway.
#
# Gateway auth token (required):
#   OPENCLAW_GATEWAY_TOKEN — bearer token that protects the gateway WebSocket/HTTP API.
#                            Set a strong random string. Agent processes inherit this
#                            env var automatically to authenticate back to the gateway.
#
# Provider API keys (at least one required for agent LLM calls — read directly from env):
#   ANTHROPIC_API_KEY   — Anthropic provider
#   OPENAI_API_KEY      — OpenAI provider
#   GOOGLE_API_KEY      — Google (Gemini) provider
#   GEMINI_API_KEY      — Google (Gemini) alternate var
#
# Default model (pick one pattern; OPENCLAW_DEFAULT_MODEL takes precedence):
#   ANTHROPIC_MODEL     — e.g. claude-sonnet-4-6  → sets primary to anthropic/<value>
#   OPENAI_MODEL        — e.g. gpt-5.4            → sets primary to openai/<value>
#   GOOGLE_MODEL        — e.g. gemini-2.5-flash   → sets primary to google/<value>
#   OPENCLAW_DEFAULT_MODEL — full provider/model string, overrides the above
#
# Webex channel (optional):
#   WEBEX_BOT_TOKEN     — bot token from developer.webex.com
#   WEBEX_WEBHOOK_URL   — public HTTPS URL for inbound messages (e.g. https://example.ngrok.io/webhooks/webex/default)
#   WEBEX_ROOM_ID       — default Webex room ID for outbound messages (base64 Y2lz... string)
#   WEBEX_ALLOW_FROM    — comma-separated Webex room IDs pre-approved for DM (skips pairing)
#   WEBEX_WEBHOOK_SECRET — optional HMAC secret for webhook verification
#   NGROK_AUTHTOKEN     — starts an ngrok tunnel on boot and uses its URL as WEBEX_WEBHOOK_URL
#
# Cisco Syslog channel (optional):
#   CISCO_SYSLOG_UDP_PORT       — UDP port to listen on (default: 5514)
#   CISCO_SYSLOG_MIN_SEVERITY   — drop messages above this severity 0-7 (default: 5 = notice; 6 = info)
#
# Device SSH access (optional — required for pyATS tools):
#   DEVICE_HOST     — management IP or hostname of the target Cisco device
#   DEVICE_HOSTNAME — IOS hostname of the device (default: primary); must match the
#                     router's configured hostname so pyATS can recognize the CLI prompt
#   DEVICE_USERNAME — SSH username on the device (default: openclaw)
#   DEVICE_OS       — pyATS OS type: iosxe (default), nxos, ios
#   DEVICE_PORT     — SSH port (default: 22)
#
# An SSH keypair is generated on first start and stored in /root/.openclaw/ssh/.
# The public key is printed to the log — add it to the device for the above user.
set -euo pipefail

# --- Validate required environment variables ---
MISSING=()
for VAR in OPENCLAW_GATEWAY_TOKEN; do
    if [[ -z "${!VAR:-}" ]]; then
        MISSING+=("$VAR")
    fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables: ${MISSING[*]}" >&2
    echo "  Set these via IOx app config or docker run -e." >&2
    exit 1
fi

# Warn (don't fail) if no AI provider key is set — user may configure later
if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" ]]; then
    echo "WARNING: No AI provider key found (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)." >&2
    echo "  The gateway will start but agents won't be able to call an LLM." >&2
fi


# --- Apply config from environment ---
# These can be set via IOx app config descriptor (package.yaml) and will be
# mapped to env vars by the IOx framework.

# Strip plugin-provided channel config before running `openclaw config set`.
# Those commands validate the full config, but plugin channels (e.g. webex) are
# unknown to the validator until plugins are loaded. The Python block below
# re-adds channel config after registering plugin paths.
python3 -c "
import json, os
cfg_path = os.path.expanduser('~/.openclaw/openclaw.json')
try:
    with open(cfg_path) as f:
        cfg = json.load(f)
    cfg.pop('channels', None)
    with open(cfg_path, 'w') as f:
        json.dump(cfg, f, indent=2)
except (FileNotFoundError, json.JSONDecodeError):
    pass
"

# Gateway auth token — written to config so the gateway enforces it on startup.
# OPENCLAW_GATEWAY_TOKEN is also read directly from the environment by agent
# processes authenticating back to the gateway, so no extra wiring is needed.
openclaw config set gateway.auth.token "${OPENCLAW_GATEWAY_TOKEN}"

if [[ -n "${OPENCLAW_GATEWAY_MODE:-}" ]]; then
    openclaw config set gateway.mode "${OPENCLAW_GATEWAY_MODE}"
fi

# When binding to a non-loopback interface (required in a container), the Control UI
# needs either explicit allowedOrigins or Host-header fallback. Since the container IP
# is assigned dynamically by IOx, use the Host-header fallback so any client that can
# reach the gateway can also use the UI without pre-configuring origins.
openclaw config set gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback true

# Provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY) are read
# directly from the environment by the gateway — no config set needed.

# Webex webhook URL — set explicitly, or derived from an ngrok tunnel for testing.
# If NGROK_AUTHTOKEN is provided and WEBEX_WEBHOOK_URL is not, start ngrok and
# wait for it to publish a public URL, then compose the webhook URL from it.
if [[ -z "${WEBEX_WEBHOOK_URL:-}" && -n "${NGROK_AUTHTOKEN:-}" ]]; then
    ngrok config add-authtoken "${NGROK_AUTHTOKEN}" >/dev/null 2>&1
    ngrok http 18789 --log=stdout > /tmp/ngrok.log 2>&1 &
    echo "ngrok: starting tunnel to port 18789 ..."
    for i in $(seq 1 20); do
        NGROK_PUBLIC_URL=$(python3 -c "
import urllib.request, json, sys
try:
    data = json.loads(urllib.request.urlopen('http://localhost:4040/api/tunnels', timeout=2).read())
    tunnels = [t['public_url'] for t in data.get('tunnels', []) if t['public_url'].startswith('https://')]
    print(tunnels[0] if tunnels else '', end='')
except Exception:
    print('', end='')
" 2>/dev/null || true)
        if [[ -n "${NGROK_PUBLIC_URL}" ]]; then
            export WEBEX_WEBHOOK_URL="${NGROK_PUBLIC_URL}/webhooks/webex/default"
            echo "ngrok: tunnel ready — ${NGROK_PUBLIC_URL}"
            break
        fi
        sleep 1
    done
    if [[ -z "${WEBEX_WEBHOOK_URL:-}" ]]; then
        echo "WARNING: ngrok tunnel did not become ready in time; Webex webhooks will not be registered." >&2
    fi
fi

# Write plugin load paths and Webex channel config directly into the JSON config
# file. openclaw reads plugin paths from plugins.load.paths (not an env var), and
# config set rejects plugin channel keys before the gateway starts because the
# plugin isn't registered yet at that point.
python3 - << PYEOF
import json, os

cfg_path = "/root/.openclaw/openclaw.json"
try:
    with open(cfg_path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cfg = {}

# Register plugin directories so openclaw loads them at startup.
plugin_paths = [
    "/opt/openclaw-plugins/webex",
    "/opt/openclaw-plugins/cisco-syslog",
    "/opt/openclaw-plugins/cisco-pyats",
]
cfg.setdefault("plugins", {}).setdefault("load", {})["paths"] = plugin_paths

# Webex channel config (must be written here — not via config set — because
# the webex channel id isn't known to the validator until the plugin is loaded).
webex = cfg.setdefault("channels", {}).setdefault("webex", {})
bot_token = os.environ.get("WEBEX_BOT_TOKEN", "")
room_id = os.environ.get("WEBEX_ROOM_ID", "")
allow_from = os.environ.get("WEBEX_ALLOW_FROM", "")
webhook_url = os.environ.get("WEBEX_WEBHOOK_URL", "")
webhook_secret = os.environ.get("WEBEX_WEBHOOK_SECRET", "")

if bot_token:
    webex["botToken"] = bot_token
if room_id:
    webex["roomId"] = room_id
if allow_from:
    webex["allowFrom"] = [s.strip() for s in allow_from.split(",") if s.strip()]
if webhook_url:
    webex["webhookUrl"] = webhook_url
if webhook_secret:
    webex["webhookSecret"] = webhook_secret

# Cisco Syslog channel — always enabled.
# udpPort must be written explicitly so hasMeaningfulChannelConfig() sees a key
# beyond "enabled" and includes the plugin in the gateway startup load.
cisco_syslog = cfg["channels"].setdefault("cisco-syslog", {})
cisco_syslog["enabled"] = True
cisco_syslog.setdefault("udpPort", int(os.environ.get("CISCO_SYSLOG_UDP_PORT", "5514")))
min_sev_env = os.environ.get("CISCO_SYSLOG_MIN_SEVERITY", "")
if min_sev_env:
    cisco_syslog["minSeverity"] = int(min_sev_env)
# Route agent replies through Webex when a bot token is configured.
if bot_token:
    cisco_syslog["outboundChannel"] = "webex"

with open(cfg_path, "w") as f:
    json.dump(cfg, f, indent=2)
print("Plugin paths and channel config written.")
PYEOF

# Default model — OPENCLAW_DEFAULT_MODEL accepts a full provider/model string
# (e.g. "google/gemini-2.5-flash") and takes precedence over the per-provider
# shorthand vars (ANTHROPIC_MODEL, OPENAI_MODEL, GOOGLE_MODEL).
if [[ -n "${OPENCLAW_DEFAULT_MODEL:-}" ]]; then
    openclaw config set agents.defaults.model.primary "${OPENCLAW_DEFAULT_MODEL}"
elif [[ -n "${ANTHROPIC_MODEL:-}" ]]; then
    openclaw config set agents.defaults.model.primary "anthropic/${ANTHROPIC_MODEL}"
elif [[ -n "${OPENAI_MODEL:-}" ]]; then
    openclaw config set agents.defaults.model.primary "openai/${OPENAI_MODEL}"
elif [[ -n "${GOOGLE_MODEL:-}" ]]; then
    openclaw config set agents.defaults.model.primary "google/${GOOGLE_MODEL}"
fi

# --- SSH keypair (generated once, persisted in the mounted volume) ---
SSH_DIR="/root/.openclaw/ssh"
KEY_PATH="${SSH_DIR}/id_ed25519"
mkdir -p "${SSH_DIR}"
chmod 700 "${SSH_DIR}"

if [[ ! -f "${KEY_PATH}" ]]; then
    ssh-keygen -t ed25519 -N "" -C "openclaw-iox@$(hostname)" -f "${KEY_PATH}" >/dev/null
    chmod 600 "${KEY_PATH}"
    echo ""
    echo "=========================================================="
    echo "  NEW SSH KEY GENERATED — add this public key to your"
    echo "  device's '${DEVICE_USERNAME:-openclaw}' user:"
    echo ""
    cat "${KEY_PATH}.pub"
    echo "=========================================================="
    echo ""
fi

# Disable strict host key checking for device connections — appropriate for a
# container where device IPs may be pre-provisioned or change between deploys.
SSH_CONFIG="/root/.ssh/config"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [[ ! -f "${SSH_CONFIG}" ]]; then
    cat > "${SSH_CONFIG}" << EOF
Host *
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    IdentityFile ${KEY_PATH}
EOF
    chmod 600 "${SSH_CONFIG}"
fi

# --- pyATS testbed generation ---
# DEVICE_HOSTNAME must match the router's configured hostname so pyATS/Unicon can
# recognize the CLI prompt (e.g. "R1#"). Defaults to "primary" for backwards
# compatibility, but should be set to the actual IOS hostname.
TESTBED_PATH="${OPENCLAW_PYATS_TESTBED:-/root/.openclaw/testbed.yaml}"
if [[ -n "${DEVICE_HOST:-}" ]]; then
    DEVICE_HOSTNAME="${DEVICE_HOSTNAME:-primary}"
    DEVICE_USERNAME="${DEVICE_USERNAME:-openclaw}"
    DEVICE_OS="${DEVICE_OS:-iosxe}"
    DEVICE_PORT="${DEVICE_PORT:-22}"

    cat > "${TESTBED_PATH}" << EOF
testbed:
  name: openclaw-iox

devices:
  ${DEVICE_HOSTNAME}:
    os: ${DEVICE_OS}
    type: router
    credentials:
      default:
        username: ${DEVICE_USERNAME}
        password: ""
        private_key_file: ${KEY_PATH}
    connections:
      default:
        protocol: ssh
        ip: ${DEVICE_HOST}
        port: ${DEVICE_PORT}
        arguments:
          connection_timeout: 30
EOF
fi

# --- Seed default agent personality files (only on first start) ---
AGENT_DIR="/root/.openclaw/agents/main/agent"
mkdir -p "${AGENT_DIR}"
if [[ ! -s "${AGENT_DIR}/SOUL.md" ]]; then
    cp /opt/openclaw-defaults/agent-soul.md "${AGENT_DIR}/SOUL.md"
fi
if [[ ! -s "${AGENT_DIR}/TOOLS.md" ]]; then
    cp /opt/openclaw-defaults/agent-tools.md "${AGENT_DIR}/TOOLS.md"
fi

# --- Print summary ---
ACTIVE_MODEL=$(openclaw config get agents.defaults.model.primary 2>/dev/null || echo "not set")
echo "OpenClaw IOx container starting"
echo "  Node:    $(node --version)"
echo "  Python:  $(python3 --version)"
echo "  pyATS:   $(python3 -c 'import importlib.metadata; print(importlib.metadata.version("pyats"))' 2>/dev/null || echo 'not found')"
echo "  Genie:   $(python3 -c 'import importlib.metadata; print(importlib.metadata.version("genie"))' 2>/dev/null || echo 'not found')"
echo "  Model:   ${ACTIVE_MODEL}"
echo "  Device:  ${DEVICE_HOST:-not configured} (hostname: ${DEVICE_HOSTNAME:-primary})"
echo "  Gateway: port 18789"
echo "  Syslog:  UDP/TCP 5514"
echo "  MDT:     HTTP 9000"

# --- Start gateway ---
# --bind lan       bind to LAN interfaces (not loopback — we need external access in a container)
# --port 18789     standard gateway port
# --force          skip "already running" guard
exec openclaw gateway run \
    --bind lan \
    --port 18789 \
    --force
