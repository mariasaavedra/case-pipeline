import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@case-pipeline/config": resolve(root, "libs/config/src/index.ts"),
      "@case-pipeline/config/types": resolve(root, "libs/config/src/types.ts"),
      "@case-pipeline/monday": resolve(root, "libs/monday/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
