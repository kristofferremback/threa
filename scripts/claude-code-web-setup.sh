#!/usr/bin/env bash
# Claude Code Web sandbox setup script.
# Paste into CC web Settings > Setup Script. Runs as root before repo clone.
# Keep this MINIMAL — only things that block session start.
# Everything else is lazy-loaded via scripts/lazy-setup.sh after clone.

# ─── Docker ──────────────────────────────────────────────────────────────────
# Start the Docker daemon with the egress proxy so it can pull images.
# The sandbox has Docker pre-installed but the daemon isn't running.

if command -v dockerd &>/dev/null && ! docker info &>/dev/null 2>&1; then
  HTTP_PROXY="${https_proxy}" HTTPS_PROXY="${https_proxy}" \
    dockerd --host unix:///var/run/docker.sock &>/tmp/dockerd.log &
  # Wait for daemon to be ready (up to 10s)
  for i in $(seq 1 20); do
    docker info &>/dev/null 2>&1 && break
    sleep 0.5
  done
fi

# ─── gh CLI ──────────────────────────────────────────────────────────────────
# Download the gh binary directly — apt is unreachable from the sandbox.

if ! command -v gh &>/dev/null; then
  _gh_version=$(curl -sL -x "${https_proxy}" -H "Authorization: token ${GH_TOKEN}" \
    "https://api.github.com/repos/cli/cli/releases/latest" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'].lstrip('v'))" 2>/dev/null)
  if [ -n "$_gh_version" ]; then
    curl -sL -x "${https_proxy}" -H "Authorization: token ${GH_TOKEN}" \
      "https://github.com/cli/cli/releases/download/v${_gh_version}/gh_${_gh_version}_linux_amd64.tar.gz" \
      -o /tmp/gh.tar.gz \
      && tar -xzf /tmp/gh.tar.gz -C /tmp \
      && cp "/tmp/gh_${_gh_version}_linux_amd64/bin/gh" /usr/local/bin/gh \
      && rm -rf /tmp/gh.tar.gz "/tmp/gh_${_gh_version}_linux_amd64"
  fi
fi

# ─── Marker ──────────────────────────────────────────────────────────────────

touch /tmp/.claude-code-web
exit 0
