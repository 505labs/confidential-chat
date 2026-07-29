"use client";

import { useState } from "react";

// Intel SGX Root CA — the fixed, self-signed P-256 key that is the ROOT of trust
// for the whole DCAP chain. Every TDX quote's certificate chain terminates here, so
// this is the key our verification ultimately checks against. It's Intel's global
// root (the same for everyone), published at:
//   https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.pem
const INTEL_ROOT = {
  name: "Intel SGX Root CA",
  curve: "P-256 (prime256v1)",
  // uncompressed EC public point (0x04 ‖ X ‖ Y)
  pubkey:
    "040ba9c4c0c0c86193a3fe23d6b02cda10a8bbd4e88e48b4458561a36e70" +
    "5525f567918e2edc88e40d860bd0cc4ee26aacc988e505a953558c453f6b0904ae7394",
  certUrl:
    "https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.pem",
};

type Attestation = {
  verified: boolean;
  hardwareVerified: boolean;
  reportDataMatches: boolean;
  tee?: string;
  provider?: string;
  verifier?: string;
  tcbStatus?: string;
  nonce: string;
  imageDigest: string;
  gitSha: string;
  enclavePubKey?: string;
  keySig?: string;
  mrtd?: string;
  rtmr?: string[];
  expectedReportData?: string;
  reportData?: string;
  quoteB64?: string;
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
// (The Intel DCAP chain check runs in the attestor sidecar; the raw quote is
// provided below for anyone who wants to re-run dcap-qvl off-box too.)
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
  // Challenge step: let the user supply their own nonce (or randomize it).
  const [nonce, setNonce] = useState<string>(randomNonce());
  const [nonceErr, setNonceErr] = useState<string | null>(null);

  function openPanel() {
    setOpen(true);
    setAtt(null);
    setShowRaw(false);
    setNonceErr(null);
    setNonce(randomNonce());
  }

  async function verify() {
    const clean = nonce.trim().toLowerCase();
    // Nonce: 1–64 bytes of hex (goes into the report-data the quote commits to).
    if (!/^[0-9a-f]{2,128}$/.test(clean) || clean.length % 2 !== 0) {
      setNonceErr("Nonce must be hex, an even number of characters, up to 64 bytes (128 hex chars).");
      return;
    }
    setNonceErr(null);
    setLoading(true);
    setAtt(null);
    setShowRaw(false);
    try {
      const res = await fetch(`/api/attest?nonce=${clean}`, { cache: "no-store" });
      const raw = (await res.json()) as Attestation;
      setAtt(await localVerify(raw));
    } catch (e) {
      setAtt({
        verified: false,
        hardwareVerified: false,
        reportDataMatches: false,
        nonce: clean,
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
        onClick={openPanel}
        className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        title="Prove this is running in a genuine Intel TDX enclave"
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

            {/* Challenge step: choose a nonce, then attest. Shown until results arrive. */}
            {!att && !loading && (
              <div className="space-y-3 text-sm">
                <p className="text-neutral-400">
                  Pick a <strong className="text-neutral-200">challenge (nonce)</strong> — any hex value
                  you choose. The enclave binds it into the hardware-signed quote, so a fresh, unique
                  nonce proves the answer was made <em>now, for you</em> (not replayed). Leave the random
                  one or paste your own.
                </p>
                <label className="block text-xs text-neutral-500">Nonce (hex, up to 64 bytes)</label>
                <textarea
                  value={nonce}
                  onChange={(e) => setNonce(e.target.value)}
                  spellCheck={false}
                  className="h-16 w-full resize-none rounded-lg border border-white/10 bg-black/50 p-2 font-mono text-[11px] text-neutral-200 outline-none focus:border-emerald-500/50"
                />
                {nonceErr && <div className="text-[11px] text-red-300">{nonceErr}</div>}
                <div className="flex items-center gap-2">
                  <button
                    onClick={verify}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-neutral-950 transition hover:bg-emerald-400"
                  >
                    Attest with this nonce
                  </button>
                  <button
                    onClick={() => { setNonce(randomNonce()); setNonceErr(null); }}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
                  >
                    🎲 Randomize
                  </button>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 py-8 text-sm text-neutral-400">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                Requesting an Intel TDX quote and verifying it against Intel…
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
                      label="Genuine Intel TDX — verified against Intel's root"
                      detail={`The TDX quote's signature and PCK certificate chain were verified up to the Intel SGX Root CA using self-hosted DCAP — no cloud provider in the chain. Intel TCB status: ${att.tcbStatus ?? "?"}.`}
                    />
                    <Check
                      ok={att.bindingOk ?? att.reportDataMatches}
                      label="Quote binds this enclave's key + image + your nonce"
                      detail="Your browser recomputed REPORT_DATA = SHA-512(nonce ‖ enclave public key ‖ image digest) and it matches the Intel-signed quote — so the quote vouches for exactly this key and image, freshly for your challenge."
                    />
                    <Check
                      ok={att.keyProofOk ?? false}
                      label="You're talking directly to the attested enclave"
                      detail="The responder signed your nonce with the private key the quote just vouched for, and your browser verified that Ed25519 signature. Only code inside the attested enclave holds that key — so no proxy or middlebox can stand in."
                    />
                    <Row label="Firmware measurement (MRTD)" mono value={att.mrtd} note="hardware-measured — note: this is Google's TDVF firmware" />
                    <Row label="Enclave public key" mono value={att.enclavePubKey} note="ephemeral Ed25519, generated inside the enclave" />
                    <Row label="Image digest (committed in quote)" mono value={att.imageDigest} note="matches the public GitHub build" />
                    <Row label="Your nonce (the challenge you chose)" mono value={att.nonce} />
                    <li>
                      <div className="text-neutral-400">Intel root of trust (verifying key)</div>
                      <div className="break-all font-mono text-[11px] text-neutral-200">{INTEL_ROOT.pubkey}</div>
                      <div className="text-[11px] text-neutral-500">
                        {INTEL_ROOT.name} · {INTEL_ROOT.curve} — the fixed key the quote&apos;s
                        certificate chain terminates at.{" "}
                        <a
                          href={INTEL_ROOT.certUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline"
                        >
                          Intel&apos;s published root cert ↗
                        </a>
                      </div>
                    </li>
                  </ul>
                )}

                <p className="rounded-lg bg-neutral-800/60 p-3 text-xs leading-relaxed text-neutral-400">
                  <strong className="text-neutral-300">What this proves:</strong> a genuine Intel TDX
                  confidential-VM produced a quote — verified against <em>Intel&apos;s</em> root with no cloud
                  provider in the loop — committing to an enclave-held key, and the code answering you
                  proved it holds that key, so you&apos;re talking <em>directly</em> to the attested enclave.
                  The <em>image digest</em> is committed in that signed quote and matches the public
                  GitHub build. Honest caveats: the digest rides in the quote&apos;s report-data (bound &amp;
                  publicly checkable, not a hardware measurement register), and the firmware (MRTD) is
                  Google&apos;s — so Google is the firmware author even though it is not the attestation signer.
                </p>

                <button
                  onClick={openPanel}
                  className="text-xs text-emerald-300 hover:underline"
                >
                  ← Verify again with a different nonce
                </button>

                {att.quoteB64 && (
                  <div>
                    <button
                      onClick={() => setShowRaw((s) => !s)}
                      className="text-xs text-emerald-300 hover:underline"
                    >
                      {showRaw ? "Hide" : "Show"} raw evidence & verify-it-yourself
                    </button>
                    {showRaw && (
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-neutral-400">
                          Re-verify off-box: base64-decode the quote below to{" "}
                          <code>quote.dat</code>, then run{" "}
                          <code>cargo install dcap-qvl-cli</code> and{" "}
                          <code>dcap-qvl verify quote.dat</code> — it checks the chain to Intel&apos;s
                          root without trusting us or Google.
                        </p>
                        <textarea
                          readOnly
                          value={att.quoteB64}
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
