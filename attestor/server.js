// TDX attestation service (Intel Trust Domain Extensions). Replaces the SEV-SNP one.
//
// Two jobs:
//   1. GET /report?data=<128-hex> — produce a TDX quote whose REPORT_DATA is that
//      64-byte value (the app packs nonce ‖ enclave_key ‖ image_digest into it),
//      via the kernel's configfs-tsm interface.
//   2. Verify that quote with dcap-qvl (Intel DCAP). The cert chain roots in the
//      Intel SGX Root CA; collateral comes from a PCS. NO cloud provider (no Google)
//      is in the verification trust base — that independence is the point of TDX.
//
// On RTMR3: we hoped to fold the image digest into RTMR3 (a runtime hardware register)
// so the container identity would be hardware-measured. GCP's TDX guest kernel exposes
// only TDX_CMD_GET_REPORT0 with NO userspace RTMR-extend path, so RTMR3 stays at its
// boot value. The image digest therefore rides in REPORT_DATA (Intel-signed), while
// MRTD (firmware) and RTMR0–2 (boot chain) ARE hardware-measured. The genuine upgrade
// over SEV-SNP-on-GCP is verifier independence, not an RTMR3 image measurement.
//
// Node built-ins only; runs privileged with /dev/tdx_guest + configfs-tsm available.
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const PORT = Number(process.env.PORT || 9000);
const DCAP = process.env.DCAP_QVL || "/usr/local/bin/dcap-qvl";
const PCCS_URL = process.env.PCCS_URL || "https://pccs.phala.network"; // Intel-collateral PCS mirror
const TSM = "/sys/kernel/config/tsm/report";

// TDX v4 quote layout: 48-byte quote header, then the TD report body. Offsets below
// are into the whole quote, into the TDREPORT10 body.
const QHDR = 48;
const OFF_MRTD = QHDR + 136;       // MR_TD (firmware / build-time launch measurement), 48B
const OFF_RTMR0 = QHDR + 328;      // RTMRs, 48B each
const OFF_REPORTDATA = QHDR + 520; // REPORT_DATA, 64B

function pull(dataHex) {
  const entry = join(TSM, "vero" + process.pid + "_" + Date.now());
  mkdirSync(entry, { recursive: true });
  try {
    writeFileSync(join(entry, "inblob"), Buffer.from(dataHex, "hex"));
    const provider = readFileSync(join(entry, "provider"), "utf8").trim();
    const quote = readFileSync(join(entry, "outblob"));
    return { quote, provider };
  } finally {
    try { rmSync(entry, { recursive: true, force: true }); } catch {}
  }
}

function attest(dataHex) {
  const { quote, provider } = pull(dataHex);
  const dir = mkdtempSync(join(tmpdir(), "tdx-"));
  try {
    writeFileSync(join(dir, "quote.dat"), quote);
    // dcap-qvl verifies the quote against Intel's root and returns a JSON verdict.
    const raw = execFileSync(DCAP, ["verify", join(dir, "quote.dat")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PCCS_URL },
    });
    // dcap-qvl prints a "Getting collateral…" line, then a JSON verdict object. It
    // exits 0 only when the quote verified against Intel's root; the JSON "status"
    // carries the TCB verdict (UpToDate / SWHardeningNeeded / OutOfDate / …). We treat
    // a clean exit + a non-revoked status as verified.
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const verdict = jsonStart >= 0 ? JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) : {};
    // execFileSync already threw if dcap-qvl exited non-zero, so reaching here means
    // the signature + PCK chain verified. Gate "verified" on the TCB not being revoked.
    const okStatuses = new Set(["UpToDate", "SWHardeningNeeded", "ConfigurationNeeded",
      "ConfigurationAndSWHardeningNeeded"]);
    const ok = okStatuses.has(verdict.status);

    const rd = quote.subarray(OFF_REPORTDATA, OFF_REPORTDATA + 64).toString("hex");
    const mrtd = quote.subarray(OFF_MRTD, OFF_MRTD + 48).toString("hex");
    const rtmr = [];
    for (let i = 0; i < 4; i++) {
      rtmr.push(quote.subarray(OFF_RTMR0 + i * 48, OFF_RTMR0 + i * 48 + 48).toString("hex"));
    }
    return {
      verified: ok,
      tee: "tdx",
      provider,                       // "tdx_guest"
      verifier: "self-hosted Intel DCAP (dcap-qvl) — no cloud provider in the chain",
      tcbStatus: verdict.status,      // "UpToDate" etc.
      reportData: rd,                 // our nonce ‖ key ‖ image binding, Intel-signed
      mrtd,                           // firmware launch measurement (Google's TDVF)
      rtmr,                           // RTMR0–3 (boot chain measured; RTMR3 = boot value)
      quoteB64: quote.toString("base64"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") { res.writeHead(200).end("ok"); return; }
    if (url.pathname !== "/report") { res.writeHead(404).end("not found"); return; }
    const dataHex = (url.searchParams.get("data") || "").toLowerCase();
    if (!/^[0-9a-f]{128}$/.test(dataHex)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "data must be 128 hex chars (64 bytes)" }));
      return;
    }
    let payload, code = 200;
    try {
      payload = JSON.stringify(attest(dataHex));
    } catch (err) {
      code = 500;
      payload = JSON.stringify({ verified: false, error: String(err.stderr || err.message || err) });
    }
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(payload);
  })
  .listen(PORT, () => console.log(`tdx attestor listening on :${PORT} (dcap=${DCAP})`));
