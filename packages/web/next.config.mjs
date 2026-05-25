/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@contractops/core", "@contractops/schemas"],
  // Server-only packages — Next must `require()` them on the server
  // rather than inline their CJS internals, and the client webpack
  // alias below makes sure they never reach the browser bundle.
  //   - `docx` — DOCX export renderer, used by /api/exports/docx
  //     (Milestone 3A).
  //   - `pg`   — PostgreSQL client, used by the PostgresPersistenceAdapter
  //     when PERSISTENCE_DRIVER=postgres (Milestone 3H). The adapter is
  //     instantiated by `lib/persistence/select-adapter.ts`, which is
  //     loaded only inside API routes / server actions.
  experimental: {
    serverComponentsExternalPackages: ["docx", "pg"],
  },
  webpack: (config, { isServer }) => {
    // Hard guarantee: heavy / Node-only packages never reach the client bundle.
    //   - Real-LLM SDKs (openai, @anthropic-ai/sdk) → server-side API routes.
    //     Client uses fetch-only proxy providers.
    //   - DOCX renderer (docx) → server-side /api/exports/docx route.
    //     Client uses fetch() + Blob to download the rendered binary.
    //   - PostgreSQL client (pg) → server-only PostgresPersistenceAdapter.
    //     Even though no client component imports it directly, `lib/persistence`
    //     re-exports the adapter; the alias keeps the bundler from following
    //     that edge into the browser bundle.
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        openai: false,
        "@anthropic-ai/sdk": false,
        docx: false,
        pg: false,
      };
    }
    return config;
  },
};

export default nextConfig;
