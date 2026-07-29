import { buildInfo, buildRunUrl } from "@/lib/build-info";

// Per-message provenance chip: the git commit SHA the answer was generated with,
// linking to the GitHub Actions build. If the message was produced by the currently
// running build (same commit) we link straight to that exact run; otherwise we fall
// back to the commit's Actions results.
export function HashBadge({ codeSha }: { codeSha?: string | null }) {
  if (!codeSha) return null;
  const short = codeSha === "dev" ? "dev" : codeSha.slice(0, 7);
  const href =
    codeSha === buildInfo.gitSha
      ? buildRunUrl()
      : `https://github.com/${buildInfo.repo}/actions?query=${codeSha}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`GitHub Actions build for code @ ${codeSha}`}
      className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 align-middle font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/20"
    >
      <span className="opacity-70">code</span> {short}
    </a>
  );
}
