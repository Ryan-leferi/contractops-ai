/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@contractops/core", "@contractops/schemas"],
  // `docx` is a server-only DOCX renderer used by /api/exports/docx.
  // Marking it external prevents Next from trying to inline its CJS internals
  // into the server bundle. It also documents intent: server-only.
  experimental: {
    serverComponentsExternalPackages: ["docx"],
  },
  webpack: (config, { isServer }) => {
    // Hard guarantee: heavy / Node-only packages never reach the client bundle.
    //   - Real-LLM SDKs (openai, @anthropic-ai/sdk) → server-side API routes.
    //     Client uses fetch-only proxy providers.
    //   - DOCX renderer (docx) → server-side /api/exports/docx route.
    //     Client uses fetch() + Blob to download the rendered binary.
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        openai: false,
        "@anthropic-ai/sdk": false,
        docx: false,
      };
    }
    return config;
  },
};

export default nextConfig;
