import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // scripts/ has no test files currently; workspace libs run their own tests.
    // This config exists for any future root-level tests.
    include: ["scripts/**/*.test.ts"],
    exclude: ["node_modules/**", "apps/**", "libs/**"],
    passWithNoTests: true,
  },
});
