import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Run lib/ and scripts/ tests from the root; apps/ workspaces run their own
    include: [
      "lib/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "apps/**"],
  },
});
