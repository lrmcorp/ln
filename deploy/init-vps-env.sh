#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -e .env.vps ]]; then
  echo '.env.vps sudah ada; rahasia lama dipertahankan.'
  exit 0
fi

umask 077
secret() { openssl rand -hex 32; }
encryption_key() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
database_password="$(secret)"
cat > .env.vps <<EOF
POSTGRES_PASSWORD=$database_password
DATABASE_URL=postgres://ln_demo:$database_password@postgres:5432/ln_demo
SESSION_SECRET=$(secret)
DATA_ENCRYPTION_KEY=$(encryption_key)
DEMO_OWNER_PASSWORD=$(secret)
DEMO_MANAGER_PASSWORD=$(secret)
DEMO_OFFICER_PASSWORD=$(secret)
DEMO_CUSTOMER_PASSWORD=$(secret)
ENABLE_DEMO_ADAPTERS=true
CADDYFILE=./Caddyfile.preview
SITE_DOMAIN=
EOF
echo '.env.vps demo dibuat dengan izin berkas 0600.'
