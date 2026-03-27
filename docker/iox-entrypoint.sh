#!/bin/bash
# docker/iox-entrypoint.sh — OpenClaw IOx container entrypoint
#
# Validates required env vars, applies any config passed via environment,
# then starts the OpenClaw gateway.
set -euo pipefail

# --- Validate required environment variables ---
MISSING=()
for VAR in OPENCLAW_GATEWAY_KEY; do
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

if [[ -n "${OPENCLAW_GATEWAY_MODE:-}" ]]; then
    openclaw config set gateway.mode "${OPENCLAW_GATEWAY_MODE}"
fi

if [[ -n "${OPENCLAW_AGENT_ID:-}" ]]; then
    openclaw config set agent.id "${OPENCLAW_AGENT_ID}"
fi

# Apply AI provider key if passed via env (openclaw config set stores it
# in ~/.openclaw/credentials/ so it persists across restarts when using
# a mounted volume)
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    openclaw config set providers.anthropic.apiKey "${ANTHROPIC_API_KEY}"
fi

# --- Print summary ---
echo "OpenClaw IOx container starting"
echo "  Node:    $(node --version)"
echo "  Python:  $(python3 --version)"
echo "  pyATS:   $(python3 -c 'import pyats; print(pyats.__version__)' 2>/dev/null || echo 'not found')"
echo "  Genie:   $(python3 -c 'import genie; print(genie.__version__)' 2>/dev/null || echo 'not found')"
echo "  Gateway: port 18789"
echo "  Syslog:  UDP/TCP 5514"
echo "  MDT:     HTTP 9000"

# --- Start gateway ---
# --bind all       bind to all interfaces (not loopback — we need external access in a container)
# --port 18789     standard gateway port
# --force          skip "already running" guard
exec openclaw gateway run \
    --bind all \
    --port 18789 \
    --force
