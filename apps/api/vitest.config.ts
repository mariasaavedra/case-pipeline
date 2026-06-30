import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    // Array form so the seed-subpath regex is matched before the bare package
    // alias. Without the wildcard, any `@case-pipeline/seed/<subpath>` (e.g.
    // db/sync-lock, db/connection) would fall through to index.ts and fail.
    alias: [
      { find: /^@case-pipeline\/seed\/(.*)$/, replacement: resolve(root, "libs/seed/src/$1.ts") },
      { find: "@case-pipeline/seed", replacement: resolve(root, "libs/seed/src/index.ts") },
      { find: "@case-pipeline/query", replacement: resolve(root, "libs/query/src/index.ts") },
      { find: "@case-pipeline/config", replacement: resolve(root, "libs/config/src/index.ts") },
      { find: "@case-pipeline/monday", replacement: resolve(root, "libs/monday/src/index.ts") },
      { find: "@case-pipeline/core", replacement: resolve(root, "libs/core/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
