// Build/deploy provenance surfaced in the UI (build-transparency model).
//   GIT_SHA / BUILD_TIME  -> baked in at image build (Dockerfile ARGs)
//   IMAGE_DIGEST          -> injected at deploy time (deploy/deploy-app.sh); a
//                            container cannot know its own registry digest at build.
export const buildInfo = {
  gitSha: process.env.GIT_SHA || process.env.NEXT_PUBLIC_GIT_SHA || "dev",
  buildTime: process.env.BUILD_TIME || process.env.NEXT_PUBLIC_BUILD_TIME || "unknown",
  imageDigest: process.env.IMAGE_DIGEST || "unpinned (local build)",
  repo: "505labs/confidential-chat",
};

export function shortSha(sha: string): string {
  return sha && sha !== "dev" ? sha.slice(0, 7) : "dev";
}

export function shortDigest(digest: string): string {
  const m = digest.match(/sha256:([0-9a-f]{12})/);
  return m ? `sha256:${m[1]}` : digest;
}
