# TDX attestor sidecar — requests an Intel-signed TDX quote (bound to a caller-supplied
# 64-byte value) via the guest's configfs-tsm interface, and verifies it with dcap-qvl
# against the Intel SGX Root CA. No cloud provider in the verification chain.
#
# Two-stage: build the dcap-qvl verifier (Rust) once, copy the binary into a slim Node
# runtime that serves the attestation endpoint.
# Build the verifier on bookworm so its glibc matches node:22-slim (also bookworm) —
# a newer builder produces a binary that needs a glibc the runtime doesn't have.
FROM rust:1-bookworm AS qvl
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev \
  && rm -rf /var/lib/apt/lists/*
RUN cargo install dcap-qvl-cli --version 0.6.1 --root /qvl

FROM node:22-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libssl3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=qvl /qvl/bin/dcap-qvl /usr/local/bin/dcap-qvl

WORKDIR /app
COPY server.js ./
ENV PORT=9000
ENV DCAP_QVL=/usr/local/bin/dcap-qvl
EXPOSE 9000
# Runs as root — required to read the TDX quote via configfs-tsm.
CMD ["node", "server.js"]
