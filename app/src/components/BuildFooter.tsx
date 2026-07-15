import { buildInfo, shortSha, shortDigest } from "@/lib/build-info";

// Persistent provenance bar. Server component: reads IMAGE_DIGEST (deploy-time env)
// that a client bundle can't see. This is the "what image is running" surface.
export function BuildFooter() {
  const commitUrl = `https://github.com/${buildInfo.repo}/commit/${buildInfo.gitSha}`;
  const pkgUrl = `https://github.com/${buildInfo.repo}/pkgs/container/confidential-chat`;
  return (
    <footer className="border-t border-white/10 bg-black/40 px-4 py-2 text-[11px] font-mono text-neutral-400 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 animate-pulseGlow rounded-full bg-emerald-400" />
          <span className="text-emerald-300">TEE&nbsp;·&nbsp;SEV-SNP</span>
        </span>
        <a
          href={pkgUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:text-emerald-300"
          title="Deployed container image digest"
        >
          image&nbsp;<span className="text-neutral-200">{shortDigest(buildInfo.imageDigest)}</span>
        </a>
        <a
          href={commitUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:text-emerald-300"
          title="Source commit this image was built from"
        >
          code&nbsp;<span className="text-neutral-200">{shortSha(buildInfo.gitSha)}</span>
        </a>
        <span className="hidden sm:inline">built&nbsp;{buildInfo.buildTime}</span>
        <span className="ml-auto text-neutral-500">
          verifiable&nbsp;build&nbsp;·&nbsp;{buildInfo.repo}
        </span>
      </div>
    </footer>
  );
}
