import { createHash, randomBytes } from "node:crypto";
import { buildInfo } from "@/lib/build-info";

export const runtime = "nodejs";

const ATTESTOR_URL = process.env.ATTESTOR_URL || "http://attestor:9000";

// Produce a hardware-signed SEV-SNP attestation, bound to a fresh client nonce and
// the running image digest. Returns the verdict + the raw evidence so a skeptic can
// re-verify independently (see the "verify it yourself" hint the UI shows).
//
// REPORT_DATA = SHA-512( nonce || imageDigest ). The 64-byte SHA-512 exactly fills
// the report's 64-byte REPORT_DATA field.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nonceHex = (url.searchParams.get("nonce") || randomBytes(32).toString("hex")).toLowerCase();
  if (!/^[0-9a-f]{2,128}$/.test(nonceHex)) {
    return Response.json({ error: "nonce must be hex (<=64 bytes)" }, { status: 400 });
  }

  const imageDigest = buildInfo.imageDigest;
  const expected = createHash("sha512")
    .update(Buffer.concat([Buffer.from(nonceHex, "hex"), Buffer.from(imageDigest, "utf8")]))
    .digest("hex");

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
  const nonceMatches = reportData === expected;

  return Response.json({
    verified: att.verified === true && nonceMatches,
    hardwareVerified: att.verified === true, // AMD cert chain + report signature
    nonceMatches, // freshness: report is bound to THIS challenge
    procModel: att.procModel,
    nonce: nonceHex,
    imageDigest, // committed into the signed report (app-asserted claim)
    gitSha: buildInfo.gitSha,
    expectedReportData: expected,
    reportData,
    measurement: att.measurement, // launch identity (firmware/kernel), hardware-measured
    chainLog: att.chainLog,
    reportB64: att.reportB64,
    vcekPem: att.vcekPem,
  });
}
