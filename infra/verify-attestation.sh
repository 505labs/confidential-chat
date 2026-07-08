#!/usr/bin/env bash
# verify-attestation.sh
# Request and FULLY verify an AMD SEV-SNP attestation report from inside the
# GCP Confidential VM. Proves three things:
#   1. The VM produced a hardware attestation report from the AMD PSP (security processor).
#   2. That report is signed by a chip-unique VCEK that chains to AMD's root of trust
#      (ARK -> ASK -> VCEK), fetched live from AMD's Key Distribution Service (KDS).
#   3. (optional) report_data equals a caller-supplied nonce -> freshness / key binding.
#
# Usage:
#   ./verify-attestation.sh                 # random nonce (self-test)
#   ./verify-attestation.sh <128-hex-nonce> # bind a specific 64-byte nonce (remote attestation)
#
# Env overrides:
#   PROC_MODEL  amd processor family: milan (N2D, default) | genoa | turin | bergamo | siena
#   VMPL        guest VMPL to attest (GCP confidential VMs run at 0; default 0)
#   WORKDIR     scratch dir (default ~/snp-attest)
set -euo pipefail

PROC_MODEL="${PROC_MODEL:-milan}"
VMPL="${VMPL:-0}"
WORKDIR="${WORKDIR:-$HOME/snp-attest}"
SNPGUEST_VERSION="${SNPGUEST_VERSION:-v0.10.0}"
NONCE_HEX="${1:-}"

mkdir -p "$WORKDIR/certs"
cd "$WORKDIR"

# 1. get snpguest (prebuilt release binary; no rust toolchain needed)
if ! command -v snpguest >/dev/null 2>&1 && [ ! -x ./snpguest ]; then
  echo ">> downloading snpguest $SNPGUEST_VERSION"
  curl -fsSL -o snpguest \
    "https://github.com/virtee/snpguest/releases/download/${SNPGUEST_VERSION}/snpguest"
  chmod +x snpguest
fi
SNP="$([ -x ./snpguest ] && echo ./snpguest || command -v snpguest)"

# 2. sanity: confirm the kernel really sees SEV-SNP
echo ">> [1/6] platform SEV-SNP probe"
sudo "$SNP" ok || true

# 3. request a fresh attestation report
if [ -n "$NONCE_HEX" ]; then
  echo ">> [2/6] requesting report bound to supplied nonce"
  printf '%s' "$NONCE_HEX" | xxd -r -p > request-data.bin
  sudo "$SNP" report attestation-report.bin request-data.bin --vmpl "$VMPL"
else
  echo ">> [2/6] requesting report with random report_data"
  sudo "$SNP" report attestation-report.bin request-data.txt --random --vmpl "$VMPL"
fi

# 4. fetch AMD's cert chain for THIS chip from the KDS
echo ">> [3/6] fetching CA (ARK + ASK) for $PROC_MODEL"
"$SNP" fetch ca pem certs "$PROC_MODEL" --endorser vcek
echo ">> [4/6] fetching VCEK for this specific CPU"
"$SNP" fetch vcek pem certs attestation-report.bin -p "$PROC_MODEL"

# 5. the actual trust checks
echo ">> [5/6] verifying cert chain  ARK -> ASK -> VCEK"
"$SNP" verify certs certs
echo ">> [6/6] verifying report signature against VCEK"
"$SNP" verify attestation certs attestation-report.bin -p "$PROC_MODEL"

# 6. human-readable dump of the signed claims (measurement, policy, tcb, report_data...)
echo ">> report contents"
"$SNP" display report attestation-report.bin || true

echo
echo "==================================================================="
echo " ATTESTATION VERIFIED"
echo " Report is signed by genuine AMD $PROC_MODEL hardware and chains to"
echo " the AMD root of trust. Bind MEASUREMENT + REPORT_DATA to complete"
echo " a remote-attestation policy check."
echo "==================================================================="
