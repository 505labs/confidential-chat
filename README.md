# 🔒 Confidential Chat

**A self-hosted, private ChatGPT-style app where the language model runs inside a
hardware-encrypted Trusted Execution Environment (TEE).** The model, user accounts,
and every conversation stay on a single GCP Confidential VM (AMD SEV-SNP) — and the
VM can cryptographically *prove* it's genuine confidential hardware via remote
attestation.

Auth, conversation history, and the chat UI come from [Open WebUI](https://github.com/open-webui/open-webui),
so there's almost no custom code — just a `docker-compose.yml` and a few infra scripts.

> ⚠️ **Demo project.** Built to show the confidential-computing flow end to end. It's
> production-*shaped*, not production-*hardened* — read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
> for the security model and trade-offs before relying on it.

## What you get

- 🔐 **Model runs in a TEE** — RAM is hardware-encrypted; prompts and weights are
  protected *in use*, not just at rest.
- 🧾 **Verifiable** — a one-command script produces and verifies an AMD SEV-SNP
  attestation report against AMD's root of trust.
- 👤 **Real auth + history** — multi-user accounts and per-user conversation storage,
  all on the VM (no external database, no data leaving the box).
- 🌐 **Real HTTPS, no domain needed** — automatic Let's Encrypt certs via `sslip.io`.
- 💸 **One small VM** — the whole stack fits on a ~$0.50/hr CPU instance.

## Architecture

```
                         GCP Confidential VM  (AMD SEV-SNP TEE)
Public user              ┌───────────────────────────────────────────┐
   │  https (443)        │  caddy ── reverse proxy, auto Let's Encrypt │
   └────────────────────┼─▶ open-webui ── auth + chat history (local) │
                         │        └─▶ llama.cpp ── CPU inference        │
                         │                 └─▶ Qwen2.5-1.5B (GGUF)      │
                         └───────────────────────────────────────────┘
   Only :80/:443 exposed. Accounts + conversations never leave the VM.
```

Full design and the decision log: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Quickstart

Full step-by-step (fresh GCP account, quotas, teardown) is in **[docs/DEPLOY.md](docs/DEPLOY.md)**.
The short version:

```bash
# local machine, gcloud authed to your account:
gcloud config set project YOUR_PROJECT_ID
./infra/create-vm.sh                     # creates the SEV-SNP VM, static IP, firewall
                                         # → prints the VM IP + PUBLIC_HOST (sslip.io)

gcloud compute scp --recurse . confidential-chat:~/confidential-chat --zone=YOUR_ZONE

# on the VM:
cd ~/confidential-chat
cp .env.example .env                     # set PUBLIC_HOST + generate the two secrets
./infra/setup-vm.sh                      # installs Docker, launches the stack
```

Then open `https://<PUBLIC_HOST>` — **the first account you create becomes the admin.**

Verify the TEE is genuine anytime:

```bash
./infra/verify-attestation.sh            # fetches AMD's certs, checks the report chain
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | The whole app stack: llama.cpp + Open WebUI + Caddy. |
| `.env.example` | Config template. Copy to `.env` (git-ignored) and fill in. |
| `infra/create-vm.sh` | Provision the Confidential VM + static IP + firewall. |
| `infra/setup-vm.sh` | Run on the VM: install Docker + launch the stack. |
| `infra/verify-attestation.sh` | Request + verify an AMD SEV-SNP attestation report. |
| `docs/DEPLOY.md` | From-scratch deployment runbook. |
| `docs/ARCHITECTURE.md` | How it works and why (design + decision log). |

## Configuration

Everything is driven by `.env` (see [`.env.example`](.env.example)):

| Variable | What it does |
| --- | --- |
| `PUBLIC_HOST` | TLS hostname — `<vm-ip-with-dashes>.sslip.io`. |
| `MODEL_HF` | Hugging Face `repo:quant` to serve (auto-downloaded). |
| `LLAMA_API_KEY` | Key llama.cpp requires; generate with `openssl rand -hex 32`. |
| `WEBUI_SECRET_KEY` | Open WebUI JWT secret; generate with `openssl rand -hex 32`. |
| `ENABLE_SIGNUP` | Allow new signups (first user becomes admin). |
| `DEFAULT_USER_ROLE` | `pending` (admin approves users) or `user` (auto-approve). |

> **Secrets never live in the repo** — only in `.env` on the VM (git-ignored).
> Regenerate `LLAMA_API_KEY` and `WEBUI_SECRET_KEY` for every deployment.

## Want a GPU?

To run a larger model on a GPU, provision a **G4 / NVIDIA RTX PRO 6000** Confidential
VM (SEV) instead. The attestation flow is identical — set `PROC_MODEL=turin` (5th-gen
EPYC) when running `verify-attestation.sh`.

## License

[MIT](LICENSE) © 2026 Snojj25
