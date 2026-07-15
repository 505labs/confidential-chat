/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // better-sqlite3 is a native module — keep it external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  env: {
    // Baked at build time (see Dockerfile ARGs). IMAGE_DIGEST is injected at deploy.
    NEXT_PUBLIC_GIT_SHA: process.env.GIT_SHA || "dev",
    NEXT_PUBLIC_BUILD_TIME: process.env.BUILD_TIME || "unknown",
  },
};
module.exports = nextConfig;
