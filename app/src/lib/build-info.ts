// Build/deploy provenance surfaced in the UI (build-transparency model).
//   GIT_SHA / BUILD_TIME  -> baked in at image build (Dockerfile ARGs)
//   IMAGE_DIGEST          -> injected at deploy time (deploy/deploy-app.sh); a
//                            container cannot know its own registry digest at build.
export const buildInfo = {
  gitSha: process.env.GIT_SHA || process.env.NEXT_PUBLIC_GIT_SHA || "dev",
  buildTime: process.env.BUILD_TIME || process.env.NEXT_PUBLIC_BUILD_TIME || "unknown",
  imageDigest: process.env.IMAGE_DIGEST || "unpinned (local build)",
  // The GitHub Actions run that built this image (set at build time by CI).
  runId: process.env.GITHUB_RUN_ID || process.env.NEXT_PUBLIC_GITHUB_RUN_ID || "",
  repo: "505labs/confidential-chat",
};

// Link to the exact Actions run that produced this image if we know it; otherwise
// fall back to the commit's Actions results.
export function buildRunUrl(): string {
  const base = `https://github.com/${buildInfo.repo}`;
  return buildInfo.runId
    ? `${base}/actions/runs/${buildInfo.runId}`
    : `${base}/actions?query=${buildInfo.gitSha}`;
}

export function shortSha(sha: string): string {
  return sha && sha !== "dev" ? sha.slice(0, 7) : "dev";
}

export function shortDigest(digest: string): string {
  const m = digest.match(/sha256:([0-9a-f]{12})/);
  return m ? `sha256:${m[1]}` : digest;
}
