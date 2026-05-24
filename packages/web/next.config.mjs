/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@contractops/core", "@contractops/schemas"],
  webpack: (config, { isServer }) => {
    // Hard guarantee: real-LLM SDKs never reach the client bundle.
    // Real-mode calls happen exclusively in server-side API routes (e.g.
    // /api/agent/deal-memo, /api/agent/counterparty-reviewer). The browser
    // uses the matching proxy provider, which only does fetch() — no SDK.
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        openai: false,
        "@anthropic-ai/sdk": false,
      };
    }
    return config;
  },
};

export default nextConfig;
