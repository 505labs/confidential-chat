"use client";

import { useState } from "react";

type Attestation = {
  verified: boolean;
  hardwareVerified: boolean;
  nonceMatches: boolean;
  procModel?: string;
  nonce: string;
  imageDigest: string;
  gitSha: string;
  measurement?: string;
  expectedReportData?: string;
  chainLog?: string[];
  reportB64?: string;
  vcekPem?: string;
  error?: string;
};

function randomNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
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
      setAtt(await res.json());
    } catch (e) {
      setAtt({
        verified: false,
        hardwareVerified: false,
        nonceMatches: false,
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
                      ok={att.nonceMatches}
                      label="Fresh — bound to your challenge"
                      detail="REPORT_DATA = SHA-512(nonce ‖ image digest). Matching proves this report was just minted for your random nonce, not replayed."
                    />
                    <Row label="Launch measurement" mono value={att.measurement} note="hardware-measured boot identity (firmware/kernel)" />
                    <Row label="Image digest (committed in report)" mono value={att.imageDigest} note="app-asserted — see note below" />
                    <Row label="Your nonce" mono value={att.nonce} />
                  </ul>
                )}

                <p className="rounded-lg bg-neutral-800/60 p-3 text-xs leading-relaxed text-neutral-400">
                  <strong className="text-neutral-300">What this proves:</strong> the report is signed
                  by real AMD confidential-computing hardware and is fresh (your nonce). The{" "}
                  <em>image digest</em> is committed into that signed report by the app — hardware
                  measures the VM's boot, not the container, so the digest is a software-asserted claim
                  bound to the hardware signature. Measured-boot of the container would close that gap.
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
