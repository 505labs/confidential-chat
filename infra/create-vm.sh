#!/usr/bin/env bash
# create-vm.sh — provision a GCP Confidential VM (AMD SEV-SNP) for the chat stack,
# reserve a static IP, and open 80/443 for Caddy. Account-agnostic: override any
# value via env vars. Run this on your LOCAL machine with gcloud authed to the
# target account (`gcloud auth login`).
#
#   PROJECT=my-proj ZONE=us-central1-a ./infra/create-vm.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-us-central1-a}"
REGION="${REGION:-${ZONE%-*}}"          # region derived from zone
VM="${VM:-confidential-chat}"
MACHINE="${MACHINE:-n2d-highcpu-16}"    # 16 vCPU / 16 GB, AMD (SEV-SNP capable)
CPU_PLATFORM="${CPU_PLATFORM:-AMD Milan}"

if [ -z "$PROJECT" ]; then
  echo "ERROR: no project set. Run: gcloud config set project <PROJECT_ID>" >&2
  exit 1
fi
echo ">> project=$PROJECT  zone=$ZONE  vm=$VM  machine=$MACHINE"
gcloud config set project "$PROJECT" >/dev/null

echo ">> enabling Compute Engine API (no-op if already on)"
gcloud services enable compute.googleapis.com >/dev/null

echo ">> creating confidential VM (SEV-SNP)"
gcloud compute instances create "$VM" \
  --zone="$ZONE" --machine-type="$MACHINE" \
  --min-cpu-platform="$CPU_PLATFORM" \
  --confidential-compute-type=SEV_SNP \
  --maintenance-policy=TERMINATE \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --tags=confidential-chat

echo ">> promoting ephemeral IP to static (keeps the sslip.io hostname stable)"
IP=$(gcloud compute instances describe "$VM" --zone="$ZONE" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create "${VM}-ip" --addresses="$IP" --region="$REGION" || true

echo ">> opening tcp:80,443 for Caddy (Let's Encrypt + serving)"
gcloud compute firewall-rules create allow-confidential-chat \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=confidential-chat \
  2>/dev/null || echo "   (firewall rule already exists)"

echo
echo "=================================================================="
echo " VM ready.   external IP: $IP"
echo " PUBLIC_HOST for .env:    ${IP//./-}.sslip.io"
echo " SSH:  gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap"
echo " Next: see docs/DEPLOY.md steps 4-7 (copy repo, setup-vm.sh, .env, up)."
echo "=================================================================="
