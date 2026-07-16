/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Native / heavy modules that must NOT be bundled by webpack — they load native
  // addons (.node) or ship their own worker/wasm assets that break when bundled.
  serverExternalPackages: [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "@napi-rs/canvas",
    "tesseract.js",
    "pdfjs-dist",
  ],
  env: {
    // Baked at build time (see Dockerfile ARGs). IMAGE_DIGEST is injected at deploy.
    NEXT_PUBLIC_GIT_SHA: process.env.GIT_SHA || "dev",
    NEXT_PUBLIC_BUILD_TIME: process.env.BUILD_TIME || "unknown",
  },
};
module.exports = nextConfig;
