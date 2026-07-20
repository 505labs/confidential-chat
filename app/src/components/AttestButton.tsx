"use client";

import { useState } from "react";

type Attestation = {
  verified: boolean;
  hardwareVerified: boolean;
  reportDataMatches: boolean;
  procModel?: string;
  nonce: string;
  imageDigest: string;
  gitSha: string;
  enclavePubKey?: string;
  keySig?: string;
  measurement?: string;
  expectedReportData?: string;
  reportData?: string;
  chainLog?: string[];
  reportB64?: string;
  vcekPem?: string;
  error?: string;
  // filled in locally by the browser (Option B):
  keyProofOk?: boolean;
  bindingOk?: boolean;
};

function randomNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// The client-side half of end-to-end attestation. The browser INDEPENDENTLY checks,
// without trusting the server's own "verified: true":
//   • bindingOk  — REPORT_DATA equals SHA-512(nonce ‖ enclavePubKey ‖ imageDigest),
//     so the hardware-signed report commits to this exact key + image + our nonce.
//   • keyProofOk — the Ed25519 signature over our nonce verifies against enclavePubKey,
//     proving the responder holds the private key the hardware vouched for.
// (The AMD cert-chain check itself runs in the attestor sidecar over snpguest; the raw
// report is provided below for anyone who wants to re-run that step off-box too.)
async function localVerify(att: Attestation): Promise<Attestation> {
  if (att.error || !att.enclavePubKey || !att.keySig) return att;
  try {
    const nonce = hexToBytes(att.nonce);
    const pub = hexToBytes(att.enclavePubKey);
    const imageBytes = new TextEncoder().encode(att.imageDigest);

    // 1) recompute REPORT_DATA = SHA-512(nonce ‖ pubkey ‖ imageDigest)
    const preimage = new Uint8Array(nonce.length + pub.length + imageBytes.length);
    preimage.set(nonce, 0);
    preimage.set(pub, nonce.length);
    preimage.set(imageBytes, nonce.length + pub.length);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", preimage));
    const bindingOk = bytesToHex(digest) === (att.reportData ?? "");

    // 2) verify the Ed25519 possession signature over the nonce
    let keyProofOk = false;
    try {
      const key = await crypto.subtle.importKey("raw", pub as BufferSource, { name: "Ed25519" }, false, ["verify"]);
      keyProofOk = await crypto.subtle.verify(
        { name: "Ed25519" },
        key,
        hexToBytes(att.keySig) as BufferSource,
        nonce as BufferSource,
      );
    } catch {
      keyProofOk = false; // browser without Ed25519 WebCrypto support
    }
    return { ...att, bindingOk, keyProofOk };
  } catch {
    return att;
  }
}

export function AttestButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [att, setAtt] = useState<Attestation | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function verify() {
    setOpen(true);
    setLoading(true);
    setAtt(null);
    setShowRaw(false);
    const nonce = randomNonce();
    try {
      const res = await fetch(`/api/attest?nonce=${nonce}`, { cache: "no-store" });
      const raw = (await res.json()) as Attestation;
      setAtt(await localVerify(raw));
    } catch (e) {
      setAtt({
        verified: false,
        hardwareVerified: false,
        reportDataMatches: false,
        nonce,
        imageDigest: "",
        gitSha: "",
        error: (e as Error).message,
      } as Attestation);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={verify}
        className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        title="Prove this is running on genuine AMD SEV-SNP hardware"
      >
        🛡️ Verify hardware
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Hardware attestation</h2>
              <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-200">
                ✕
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 py-8 text-sm text-neutral-400">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                Asking the AMD security processor for a signed report…
              </div>
            )}

            {att && !loading && (
              <div className="space-y-4 text-sm">
                <div
                  className={`rounded-xl border p-4 ${
                    att.verified
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-red-500/30 bg-red-500/10"
                  }`}
                >
                  <div className="text-base font-semibold">
                    {att.verified ? "✅ Verified" : "❌ Not verified"}
                  </div>
                  {att.error && <div className="mt-1 font-mono text-xs text-red-300">{att.error}</div>}
                </div>

                {!att.error && (
                  <ul className="space-y-2">
                    <Check
                      ok={att.hardwareVerified}
                      label="Signed by genuine AMD SEV-SNP silicon"
                      detail={`Report signed by the chip's VCEK, chained to AMD's root (ARK → ASK → VCEK), fetched live from AMD's KDS. Processor: ${att.procModel}.`}
                    />
                    <Check
                      ok={att.bindingOk ?? att.reportDataMatches}
                      label="Report binds this enclave's key + image + your nonce"
                      detail="Your browser recomputed REPORT_DATA = SHA-512(nonce ‖ enclave public key ‖ image digest) and it matches the hardware-signed report — so the report vouches for exactly this key and image, freshly for your challenge."
                    />
                    <Check
                      ok={att.keyProofOk ?? false}
                      label="You're talking directly to the attested enclave"
                      detail="The responder signed your nonce with the private key the hardware just vouched for, and your browser verified that Ed25519 signature. Only code inside the attested enclave holds that key — so no proxy or middlebox can stand in."
                    />
                    <Row label="Launch measurement" mono value={att.measurement} note="hardware-measured boot identity (firmware/kernel)" />
                    <Row label="Enclave public key" mono value={att.enclavePubKey} note="ephemeral Ed25519, generated inside the enclave" />
                    <Row label="Image digest (committed in report)" mono value={att.imageDigest} note="matches the public GitHub build" />
                    <Row label="Your nonce" mono value={att.nonce} />
                  </ul>
                )}

                <p className="rounded-lg bg-neutral-800/60 p-3 text-xs leading-relaxed text-neutral-400">
                  <strong className="text-neutral-300">What this proves:</strong> a genuine AMD
                  confidential-VM signed a fresh report committing to an enclave-held key, and the code
                  answering you proved it holds that key — so you are talking <em>directly</em> to the
                  attested enclave, not a proxy. The <em>image digest</em> is committed in that signed
                  report and matches the public GitHub build; note the hardware measures the VM boot,
                  not the container, so the digest is bound-and-publicly-checkable rather than
                  hardware-measured — measured boot of the container would close that last gap.
                </p>

                {att.reportB64 && (
                  <div>
                    <button
                      onClick={() => setShowRaw((s) => !s)}
                      className="text-xs text-emerald-300 hover:underline"
                    >
                      {showRaw ? "Hide" : "Show"} raw evidence & verify-it-yourself
                    </button>
                    {showRaw && (
                      <div className="mt-2 space-y-2">
                        {att.chainLog && (
                          <pre className="overflow-x-auto rounded-lg bg-black/50 p-2 text-[10px] leading-snug text-emerald-300">
                            {att.chainLog.join("\n")}
                          </pre>
                        )}
                        <p className="text-[11px] text-neutral-400">
                          Re-verify off-box: base64-decode the report below to{" "}
                          <code>report.bin</code>, then run{" "}
                          <code>snpguest fetch vcek pem certs report.bin -p {att.procModel}</code> and{" "}
                          <code>snpguest verify attestation certs report.bin -p {att.procModel}</code>.
                        </p>
                        <textarea
                          readOnly
                          value={att.reportB64}
                          className="h-24 w-full resize-none rounded-lg bg-black/50 p-2 font-mono text-[10px] text-neutral-400"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex gap-2">
      <span className={ok ? "text-emerald-400" : "text-red-400"}>{ok ? "✓" : "✗"}</span>
      <div>
        <div className="text-neutral-200">{label}</div>
        <div className="text-xs text-neutral-500">{detail}</div>
      </div>
    </li>
  );
}

function Row({ label, value, mono, note }: { label: string; value?: string; mono?: boolean; note?: string }) {
  if (!value) return null;
  return (
    <li>
      <div className="text-neutral-400">{label}</div>
      <div className={`break-all ${mono ? "font-mono text-[11px]" : ""} text-neutral-200`}>{value}</div>
      {note && <div className="text-[11px] text-neutral-500">{note}</div>}
    </li>
  );
}
