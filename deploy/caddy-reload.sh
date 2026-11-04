#!/usr/bin/env bash
# Restart Caddy when its Caddyfile changed since the last deploy.
# `docker compose up -d` leaves a running Caddy alone when only the mounted
# Caddyfile changes, and rsync replaces the file, so the container keeps reading
# the old one. A restart mounts the new file. Run from ~/ln by deploy-demo.yml.
set -euo pipefail
cd "$(dirname "$0")/.."
caddyfile="$(sed -n 's/^CADDYFILE=//p' .env.vps | tail -1)"
caddyfile="deploy/${caddyfile:-./Caddyfile.preview}"
now="$(sha256sum "$caddyfile" | cut -d' ' -f1)"
if [[ "$(cat "$HOME/.ln-caddy-hash" 2>/dev/null || true)" != "$now" ]]; then
  sudo -n docker compose --env-file .env.vps -f deploy/compose.yaml restart caddy
  echo "$now" > "$HOME/.ln-caddy-hash"
  echo "Caddy restarted: $caddyfile changed."
else
  echo "Caddy config unchanged."
fi
