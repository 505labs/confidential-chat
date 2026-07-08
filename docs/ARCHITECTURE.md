# Architecture & decisions

What this project is, how the pieces fit, and *why* it's built this way — so a
future redeploy (or a new person) understands the reasoning, not just the steps.

## Goal

A private chatbot demo where **the model runs inside a hardware-encrypted Trusted
Execution Environment (TEE)**, and the VM can *prove* it's genuine confidential
hardware via remote attestation. Everything — model, user accounts, chat history —
lives on a single GCP Confidential VM.

## The stack

```
                         GCP Confidential VM  (AMD SEV-SNP TEE, RAM encrypted)
Public user              ┌───────────────────────────────────────────────┐
   │  HTTPS :443          │  caddy       auto Let's Encrypt TLS            │
   └────────────────────┼─▶ open-webui  auth + chat history (local DB)   │
                         │       │  http://llama:8000  (API-key on the    │
                         │       │                      internal network) │
                         │       └─▶ llama.cpp   CPU inference             │
                         │                └─▶ Qwen2.5-1.5B (GGUF)          │
                         └───────────────────────────────────────────────┘
   Only :80/:443 are exposed. Accounts + conversations never leave the VM.
```

All three services are Docker containers on one private bridge network, defined in
`docker-compose.yml`. Only Caddy publishes ports (80/443); llama.cpp is reachable
only inside the Docker network.

## Component choices — and why

| Component | Why this one |
| --- | --- |
| **AMD SEV-SNP Confidential VM** (N2D) | Cheapest way to get a real TEE on GCP for a CPU demo. RAM is hardware-encrypted; supports remote attestation. (For a GPU model, the equivalent is a **G4 / RTX PRO 6000** VM using SEV — same attestation flow, `PROC_MODEL=turin`.) |
| **llama.cpp** | Dead-simple CPU inference with an OpenAI-compatible API. `--api-key` locks it down. Auto-downloads GGUF models with `-hf`. |
| **Open WebUI** | Gave us **auth + conversation history + chat UI for free**. This replaced an earlier custom Next.js frontend — see decision log. Stores everything in a local DB on the VM. |
| **Caddy** | One-line reverse proxy with automatic Let's Encrypt certificates. |
| **sslip.io** | Free wildcard DNS (`<ip-dashed>.sslip.io` → that IP) so Caddy gets a *real* trusted cert with no domain purchase and no DNS config. |

## Security model

- **In-use protection:** SEV-SNP encrypts the VM's memory in hardware. The model
  weights, prompts, accounts, and chat history are protected while in use, not just
  at rest — that's the point of a TEE.
- **Attestation:** `infra/verify-attestation.sh` asks the AMD security processor for
  a signed report, fetches the chip's cert from AMD's KDS, and verifies the chain
  (ARK → ASK → VCEK). This proves the workload runs on genuine, unmodified AMD
  confidential hardware. The report's `REPORT_DATA` field can bind a nonce/public
  key for a full remote-attestation handshake.
- **Exposure surface:** only 80/443 are open. The model API is never public — Open
  WebUI reaches llama.cpp over the internal Docker network, authenticating with
  `LLAMA_API_KEY`. A public IP attracts constant bot scans (`/.env`, `/.git`, …);
  these hit only Open WebUI, which is behind login.
- **Secrets:** live in `.env` on the VM (git-ignored) — never committed. Regenerate
  `LLAMA_API_KEY` and `WEBUI_SECRET_KEY` per deployment.

## Decision log (how we got here)

These were real forks during the build; recording them so we don't re-litigate:

1. **CPU N2D first, GPU later.** We proved the whole confidential + attestation +
   chat flow on a cheap CPU VM (`n2d-highcpu-16`) before spending on a GPU. The GPU
   path (G4 / RTX PRO 6000, SEV) reuses the identical CPU-side attestation flow.
2. **Custom Vercel frontend → dropped.** We first built a Next.js + AI SDK chat UI on
   Vercel with a shared-password gate, talking to the model over a public
   (API-key + TLS) endpoint. It worked, but adding real auth + a database for
   conversation history meant either an external DB (Supabase) or exposing a DB
   publicly — extra cost, extra surface, and data leaving the TEE.
3. **Open WebUI won on simplicity.** It already ships auth + conversation history +
   a polished chat UI, and stores everything locally on the VM. For a demo optimizing
   for "least cost, least code, keep data on the VM," this beat custom code + Supabase.
   The custom frontend was removed.
4. **sslip.io over owning a domain.** Real Let's Encrypt TLS with zero DNS work.
5. **Everything on one VM.** Because the frontend serves users directly from the VM
   (via Caddy), the database is just `localhost` — nothing extra to expose, and all
   data stays inside the TEE. This is cheaper and more private than a cloud frontend
   + cloud DB.

## Repo layout

```
confidential-chat/
├── README.md                 # overview + quickstart
├── docker-compose.yml        # the whole app stack
├── .env.example              # config template (copy to .env, never commit .env)
├── docs/
│   ├── DEPLOY.md             # from-scratch redeploy runbook (new GCP account)
│   └── ARCHITECTURE.md       # this file
└── infra/
    ├── create-vm.sh          # provision the SEV-SNP VM + static IP + firewall
    ├── setup-vm.sh           # run on the VM: install Docker + launch the stack
    └── verify-attestation.sh # request + verify an AMD SEV-SNP attestation report
```
