/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@contractops/core", "@contractops/schemas"],
  webpack: (config, { isServer }) => {
    // Hard guarantee: the openai SDK never reaches the client bundle.
    // Real-mode OpenAI calls happen exclusively in server-side API routes
    // (e.g. /api/agent/deal-memo). The browser uses createOpenAIProxyProvider
    // which only does fetch(), no SDK.
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        openai: false,
      };
    }
    return config;
  },
};

export default nextConfig;
