// Minimal attestation service. GET /report?data=<128-hex> (a 64-byte value the
// caller wants bound into REPORT_DATA). Produces a VCEK-signed SEV-SNP report,
// fetches + verifies the AMD cert chain, and returns the raw report + verdict.
//
// No framework — Node built-ins only. Runs as root with /dev/sev-guest mounted.
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const PORT = Number(process.env.PORT || 9000);
const PROC = process.env.PROC_MODEL || "milan";
const SNP = "/usr/local/bin/snpguest";

// Field offsets in the SEV-SNP ATTESTATION_REPORT structure (AMD spec).
const OFF_REPORT_DATA = 0x50; // 64 bytes
const OFF_MEASUREMENT = 0x90; // 48 bytes

function run(args, dir) {
  return execFileSync(SNP, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function attest(dataHex) {
  const dir = mkdtempSync(join(tmpdir(), "attest-"));
  try {
    writeFileSync(join(dir, "request-data.bin"), Buffer.from(dataHex, "hex"));
    // 1) ask the PSP for a report bound to our 64-byte value
    run(["report", "attestation-report.bin", "request-data.bin", "--vmpl", "0"], dir);
    // 2) fetch AMD's published certs for THIS chip
    run(["fetch", "ca", "pem", "certs", PROC, "--endorser", "vcek"], dir);
    run(["fetch", "vcek", "pem", "certs", "attestation-report.bin", "-p", PROC], dir);
    // 3) the trust checks — these throw (non-zero exit) if anything fails
    const certsOut = run(["verify", "certs", "certs"], dir);
    const attOut = run(["verify", "attestation", "certs", "attestation-report.bin", "-p", PROC], dir);

    const report = readFileSync(join(dir, "attestation-report.bin"));
    const vcek = readFileSync(join(dir, "certs", "vcek.pem"), "utf8");
    return {
      verified: true,
      procModel: PROC,
      reportData: report.subarray(OFF_REPORT_DATA, OFF_REPORT_DATA + 64).toString("hex"),
      measurement: report.subarray(OFF_MEASUREMENT, OFF_MEASUREMENT + 48).toString("hex"),
      reportB64: report.toString("base64"),
      vcekPem: vcek,
      chainLog: (certsOut + attOut).trim().split("\n").map((s) => s.trim()).filter(Boolean),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    if (url.pathname !== "/report") {
      res.writeHead(404).end("not found");
      return;
    }
    const dataHex = (url.searchParams.get("data") || "").toLowerCase();
    if (!/^[0-9a-f]{128}$/.test(dataHex)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "data must be 128 hex chars (64 bytes)" }));
      return;
    }
    try {
      const result = attest(dataHex);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ verified: false, error: String(err.stderr || err.message || err) }));
    }
  })
  .listen(PORT, () => console.log(`attestor listening on :${PORT} (proc=${PROC})`));
