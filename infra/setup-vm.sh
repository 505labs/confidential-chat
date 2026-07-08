#!/usr/bin/env bash
# setup-vm.sh — run this ON the VM, from the repo directory, after you've copied
# the repo up and created .env. Installs Docker (if needed) and launches the stack.
#
#   cd ~/confidential-chat && ./infra/setup-vm.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env  then edit it." >&2
  echo "  - PUBLIC_HOST = <this VM's IP with dashes>.sslip.io" >&2
  echo "  - LLAMA_API_KEY / WEBUI_SECRET_KEY = openssl rand -hex 32" >&2
  exit 1
fi

echo ">> [1/3] installing Docker (if missing)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi

echo ">> [2/3] launching the stack"
sudo docker compose up -d

echo ">> [3/3] waiting for the model to download + load"
host=$(grep -E '^PUBLIC_HOST=' .env | cut -d= -f2)
for i in $(seq 1 90); do
  if sudo docker exec open-webui curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    echo "   Open WebUI is up."; break
  fi
  sleep 5
done

echo
echo "=================================================================="
echo " Stack running. Open:  https://${host}"
echo " First account you create becomes the admin."
sudo docker compose ps
echo "=================================================================="
