import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@contractops/schemas": resolve(root, "packages/schemas/src/index.ts"),
      "@contractops/core": resolve(root, "packages/core/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
  },
});
