import { createHash, randomBytes } from "node:crypto";
import { buildInfo } from "@/lib/build-info";
import { enclavePublicKeyRaw, enclavePublicKeyHex, enclaveSign } from "@/lib/enclave-key";

export const runtime = "nodejs";

const ATTESTOR_URL = process.env.ATTESTOR_URL || "http://attestor:9000";

// End-to-end ("Option B") remote attestation.
//
// The enclave holds an ephemeral Ed25519 key (see lib/enclave-key). We bind BOTH the
// client's nonce AND the enclave public key into the 64-byte REPORT_DATA the AMD chip
// signs:
//
//     REPORT_DATA = SHA-512( nonce || enclavePubKey || imageDigest )
//
// and we also sign the client's nonce with the enclave private key. A client then
// checks three things:
//   1. the report's signature chains to AMD (genuine SEV-SNP hardware),
//   2. REPORT_DATA == SHA-512(nonce || enclavePubKey || imageDigest)   (the report
//      commits to THIS key, THIS image, and THIS challenge — freshness), and
//   3. the returned Ed25519 signature over the nonce verifies against enclavePubKey
//      (proof the responder actually holds the private key the hardware vouched for).
// Passing all three ⇒ the client is talking directly to the attested enclave.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nonceHex = (url.searchParams.get("nonce") || randomBytes(32).toString("hex")).toLowerCase();
  if (!/^[0-9a-f]{2,128}$/.test(nonceHex)) {
    return Response.json({ error: "nonce must be hex (<=64 bytes)" }, { status: 400 });
  }
  const nonce = Buffer.from(nonceHex, "hex");
  const imageDigest = buildInfo.imageDigest;

  // REPORT_DATA binds nonce + enclave key + image digest (64-byte SHA-512 fills the field).
  const expected = createHash("sha512")
    .update(Buffer.concat([nonce, enclavePublicKeyRaw, Buffer.from(imageDigest, "utf8")]))
    .digest("hex");

  // Possession proof: the enclave signs the client's nonce with its private key.
  const keySig = enclaveSign(nonce).toString("hex");

  let att: Record<string, unknown>;
  try {
    const res = await fetch(`${ATTESTOR_URL}/report?data=${expected}`, { cache: "no-store" });
    att = await res.json();
    if (!res.ok || !att.verified) {
      return Response.json(
        { verified: false, error: att.error ?? `attestor HTTP ${res.status}` },
        { status: 502 },
      );
    }
  } catch (e) {
    return Response.json(
      { verified: false, error: `attestor unreachable: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const reportData = String(att.reportData ?? "");
  const reportDataMatches = reportData === expected;

  return Response.json({
    verified: att.verified === true && reportDataMatches,
    hardwareVerified: att.verified === true, // AMD cert chain + report signature
    reportDataMatches, // freshness + binding: report commits to nonce||key||image
    procModel: att.procModel,
    nonce: nonceHex,
    imageDigest, // committed into the signed report
    gitSha: buildInfo.gitSha,
    // --- Option B: the enclave-key binding a client re-checks locally ---
    enclavePubKey: enclavePublicKeyHex, // 32-byte Ed25519 public key
    keySig, // Ed25519(nonce) by the enclave private key — proves possession
    expectedReportData: expected,
    reportData,
    measurement: att.measurement, // launch identity (firmware/kernel), hardware-measured
    chainLog: att.chainLog,
    reportB64: att.reportB64,
    vcekPem: att.vcekPem,
  });
}
