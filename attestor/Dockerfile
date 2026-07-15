# Attestor sidecar — the only container with access to /dev/sev-guest. It asks the
# AMD PSP for a VCEK-signed SEV-SNP report bound to a caller-supplied 64-byte value,
# fetches AMD's cert chain from the KDS, verifies it, and returns the evidence.
# Kept tiny and separate so the app itself stays unprivileged.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG SNPGUEST_VERSION=v0.10.0
RUN curl -fsSL -o /usr/local/bin/snpguest \
    "https://github.com/virtee/snpguest/releases/download/${SNPGUEST_VERSION}/snpguest" \
  && chmod +x /usr/local/bin/snpguest

WORKDIR /app
COPY server.js ./
ENV PORT=9000
ENV PROC_MODEL=milan
EXPOSE 9000
# Runs as root (default) — required to ioctl /dev/sev-guest.
CMD ["node", "server.js"]
