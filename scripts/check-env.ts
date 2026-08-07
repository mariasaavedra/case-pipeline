// =============================================================================
// Environment check — standalone
// =============================================================================
// The same validation the API runs at startup, runnable on its own:
//
//   npm run check:env
//
// Run this on a server BEFORE deploying. From this release the API refuses to
// start on a configuration error, so a fault that has been sitting in .env
// unnoticed turns into a failed boot rather than a silent misbehaviour — which
// is the point, but it is a much better surprise on your terms than during a
// deploy.
//
// Exits 1 when the API would refuse to start, 0 otherwise (warnings included).
// Never prints a value, only variable names — safe to run with output captured.
// =============================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvironment, reportEnvironment } from "../apps/api/src/config/env-check.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const issues = checkEnvironment({
  envFilePath: path.join(ROOT, ".env"),
  examplePath: path.join(ROOT, ".env.example"),
});

const shouldFail = reportEnvironment(issues);

if (shouldFail) {
  console.error("\nThe API would refuse to start with this configuration.");
  process.exit(1);
}

const warnings = issues.filter((i) => i.level === "warning").length;
console.log(
  warnings > 0
    ? `\nNo blocking errors. ${warnings} warning(s) above are worth fixing but will not stop a boot.`
    : "\nConfiguration is clean.",
);
