# Deploy from scratch (new GCP account / new server)

This is the full runbook to stand the whole thing up on a **fresh Google Cloud
account and project**. Everything account-specific is listed in
[§ What changes per deployment](#what-changes-per-deployment) at the bottom.

Total time: ~15 minutes (most of it the model download).

---

## 0. Prerequisites (local machine)

- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install)
- A GCP **project with billing enabled**
- Authenticate to the **new** account and select the project:

```
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

> **Quota note:** the VM needs an AMD **SEV-SNP–capable** machine (N2D, "AMD Milan"
> or newer). These exist in most regions, but a brand-new project may have a low
> `N2D CPUs` quota. If `create-vm.sh` fails with a quota error, request an increase
> for **N2D CPUs** in your target region (IAM & Admin → Quotas).

---

## 1. Provision the Confidential VM

```
./infra/create-vm.sh
```

Override defaults with env vars if you like:

```
PROJECT=YOUR_PROJECT_ID ZONE=europe-west4-a VM=confidential-chat ./infra/create-vm.sh
```

This creates the SEV-SNP VM, reserves a **static IP**, and opens **tcp:80,443**.
It prints two things you need next:

```
external IP:            203.0.113.7
PUBLIC_HOST for .env:   203-0-113-7.sslip.io
```

`sslip.io` is a free wildcard DNS that maps `203-0-113-7.sslip.io` → `203.0.113.7`,
so Caddy can get a real Let's Encrypt cert with **no domain and no DNS setup**.

---

## 2. (Optional) SSH over IAP

`gcloud compute ssh <VM> --zone=<zone>` works out of the box on the default network.
To use the private **IAP** tunnel instead (no public SSH port), enable the API once
and add a firewall rule for the IAP range:

```
gcloud services enable iap.googleapis.com
gcloud compute firewall-rules create allow-iap-ssh \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20
```

Then add `--tunnel-through-iap` to any `gcloud compute ssh`/`scp` command below.

---

## 3. Copy the repo to the VM

From your local clone (this repo root):

```
gcloud compute scp --recurse . confidential-chat:~/confidential-chat --zone=YOUR_ZONE
```

(add `--tunnel-through-iap` if you set that up)

---

## 4. Configure `.env` on the VM

```
gcloud compute ssh confidential-chat --zone=YOUR_ZONE
cd ~/confidential-chat
cp .env.example .env
```

Edit `.env`:

- `PUBLIC_HOST` = the `…​.sslip.io` value printed in step 1
- `LLAMA_API_KEY` = `openssl rand -hex 32`
- `WEBUI_SECRET_KEY` = `openssl rand -hex 32`
- `DEFAULT_USER_ROLE` = `user` for a friction-free demo, or `pending` to approve users

---

## 5. Launch

Still on the VM, in `~/confidential-chat`:

```
./infra/setup-vm.sh
```

This installs Docker (if needed), runs `docker compose up -d`, and waits for the
model to download and load. First boot pulls ~1 GB (the GGUF model) + the images.

---

## 6. First login

Open **`https://<PUBLIC_HOST>`** in a browser. Caddy may take ~30 s on first load
to obtain the TLS certificate. **The first account you create becomes the admin.**
Conversations are saved automatically per user, in Open WebUI's local DB on the VM.

---

## 7. (Optional) Verify the TEE is genuine

```
./infra/verify-attestation.sh
```

Fetches AMD's cert chain from the KDS and proves the VM is real SEV-SNP hardware.
Use `PROC_MODEL=turin ./infra/verify-attestation.sh` on 5th-gen EPYC (e.g. a GPU G4 VM).

---

## What changes per deployment

Everything below is deployment-specific. Nothing sensitive is committed to the repo.

| Item | Where | How to set |
| --- | --- | --- |
| GCP project | `gcloud config` / `PROJECT=` | your new project id |
| Zone / region | `ZONE=` env | any SEV-SNP region |
| VM external IP | printed by `create-vm.sh` | becomes `PUBLIC_HOST` |
| `PUBLIC_HOST` | `.env` | `<ip-with-dashes>.sslip.io` |
| `LLAMA_API_KEY` | `.env` | **regenerate** `openssl rand -hex 32` |
| `WEBUI_SECRET_KEY` | `.env` | **regenerate** `openssl rand -hex 32` |
| Admin account | first signup in the UI | create on first visit |

---

## Teardown

```
gcloud compute instances delete confidential-chat --zone=YOUR_ZONE
gcloud compute addresses delete confidential-chat-ip --region=YOUR_REGION
gcloud compute firewall-rules delete allow-confidential-chat
```

## Cost

The VM bills while running (~$0.50/hr for `n2d-highcpu-16`). Stop it when idle
(`gcloud compute instances stop …`); the containers auto-restart on start. A stopped
VM keeps its disk (and all conversations) but releases the GPU/CPU — you only pay
for the disk + reserved static IP while stopped.
