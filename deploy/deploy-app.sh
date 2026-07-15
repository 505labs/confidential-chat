#!/usr/bin/env bash
# deploy-app.sh — deploy the custom chat app onto the SEV-SNP VM.
# Resolves the CI-built image DIGEST from GHCR, writes the VM .env, copies the
# compose file up, and brings the stack up. Run locally with gcloud authed.
#
#   PUBLIC_HOST=34-9-244-131.sslip.io \
#   AUTH_GOOGLE_ID=... AUTH_GOOGLE_SECRET=... \
#   ./deploy/deploy-app.sh
#
# Optional overrides: PROJECT, ZONE, VM, MODEL_HF, IMAGE, TAG, LLAMA_API_KEY,
# AUTH_SECRET. Missing secrets are generated (AUTH_SECRET, LLAMA_API_KEY) except
# the Google OAuth pair, which you must supply.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-us-central1-b}"
VM="${VM:-confidential-chat}"
IMAGE="${IMAGE:-ghcr.io/505labs/confidential-chat}"
TAG="${TAG:-latest}"
MODEL_HF="${MODEL_HF:-Qwen/Qwen2.5-1.5B-Instruct-GGUF:q4_k_m}"

: "${PUBLIC_HOST:?set PUBLIC_HOST=<ip-with-dashes>.sslip.io}"
: "${AUTH_GOOGLE_ID:?set AUTH_GOOGLE_ID (Google OAuth client id)}"
: "${AUTH_GOOGLE_SECRET:?set AUTH_GOOGLE_SECRET (Google OAuth client secret)}"
AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"
LLAMA_API_KEY="${LLAMA_API_KEY:-$(openssl rand -hex 32)}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"   # true = no approval gate, any Google user is active

echo ">> resolving image digest for $IMAGE:$TAG"
# Parse the top-level index digest from the inspect output (portable across
# buildx versions; the --format Go template isn't available everywhere).
DIGEST="$(docker buildx imagetools inspect "$IMAGE:$TAG" 2>/dev/null | awk '/^Digest:/{print $2; exit}')"
if [[ ! "$DIGEST" =~ ^sha256: ]]; then
  echo "ERROR: could not resolve a sha256 digest (got '$DIGEST'). Has CI built + pushed the image, and is the package public?" >&2
  exit 1
fi
APP_IMAGE="${IMAGE}@${DIGEST}"
echo "   -> $APP_IMAGE"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$(dirname "$0")/docker-compose.vm.yml" "$WORK/docker-compose.yml"
cat > "$WORK/.env" <<EOF
APP_IMAGE=$APP_IMAGE
IMAGE_DIGEST=$DIGEST
PUBLIC_HOST=$PUBLIC_HOST
MODEL_HF=$MODEL_HF
LLAMA_API_KEY=$LLAMA_API_KEY
AUTH_SECRET=$AUTH_SECRET
AUTH_GOOGLE_ID=$AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET=$AUTH_GOOGLE_SECRET
AUTO_APPROVE=$AUTO_APPROVE
EOF

echo ">> copying compose + .env to $VM ($ZONE)"
gcloud compute scp --project "$PROJECT" --zone "$ZONE" \
  "$WORK/docker-compose.yml" "$WORK/.env" "$VM:~/app-deploy/" --quiet

echo ">> launching stack on the VM"
gcloud compute ssh --project "$PROJECT" --zone "$ZONE" "$VM" --quiet --command '
  set -e
  command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sudo sh; }
  cd ~/app-deploy
  # Clear any pre-compose standalone containers (e.g. an earlier llama run) so
  # compose can claim the container names, and tear down a prior compose deploy.
  sudo docker compose down --remove-orphans 2>/dev/null || true
  sudo docker rm -f llama app caddy 2>/dev/null || true
  sudo docker compose pull
  sudo docker compose up -d
  sudo docker compose ps
'

echo
echo "=================================================================="
echo " Deployed.  https://$PUBLIC_HOST"
echo " image digest: $DIGEST"
echo " First Google account to sign in becomes the admin."
echo "=================================================================="
