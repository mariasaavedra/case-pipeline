import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@case-pipeline/seed/db/schema": resolve(root, "libs/seed/src/db/schema.ts"),
      "@case-pipeline/seed": resolve(root, "libs/seed/src/index.ts"),
      "@case-pipeline/config": resolve(root, "libs/config/src/index.ts"),
      "@case-pipeline/monday": resolve(root, "libs/monday/src/index.ts"),
      "@case-pipeline/core": resolve(root, "libs/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
