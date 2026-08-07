// =============================================================================
// Environment validation tests
// =============================================================================
// The first two describe blocks reconstruct the actual production incidents
// this module exists to prevent. If either ever goes green-by-accident, the
// checker has stopped earning its place in the boot path.
// =============================================================================

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkEnvironment, reportEnvironment, type EnvIssue } from "./env-check";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "envcheck-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a .env-shaped file and return its path. */
function envFile(contents: string, name = ".env"): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, contents);
  return p;
}

const GOOD_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjF9.c2lnbmF0dXJl";

/** A minimally valid deployed environment, to isolate one fault at a time. */
const DEPLOYED = {
  NODE_ENV: "production",
  DB_SOURCE: "live",
  MONDAY_API_TOKEN: GOOD_TOKEN,
  API_URL: "https://app.example.com",
  FRONTEND_URL: "https://app.example.com",
  APP_ENCRYPTION_KEY: "a".repeat(64),
  BACKUP_ENCRYPTION_KEY: "b".repeat(64),
} satisfies NodeJS.ProcessEnv;

const errorsFor = (issues: EnvIssue[], variable: string) =>
  issues.filter((i) => i.variable === variable && i.level === "error");

describe("regression: the 2026-08-07 duplicate token", () => {
  // .env carried MONDAY_API_TOKEN twice; the second was the real token with the
  // .env.example placeholder glued onto the end. The last definition wins, so
  // the effective value was garbage and every write 401'd for days.
  test("catches a key defined twice, naming both line numbers", () => {
    const p = envFile(
      [
        "DB_SOURCE=live",
        `MONDAY_API_TOKEN=${GOOD_TOKEN}MONDAY_API_TOKEN=tu_token`,
        `MONDAY_API_TOKEN=${GOOD_TOKEN}`,
      ].join("\n"),
    );
    const issues = checkEnvironment({ env: { ...DEPLOYED }, envFilePath: p });
    const dup = errorsFor(issues, "MONDAY_API_TOKEN");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toContain("defined 2 times");
    expect(dup[0]!.message).toContain("lines 2, 3");
  });

  test("catches the mangled value on its own, even without the duplicate", () => {
    // The independent half of the same bug: a token with something appended is
    // still truthy, still "set", and no longer a JWT.
    const issues = checkEnvironment({
      env: { ...DEPLOYED, MONDAY_API_TOKEN: `${GOOD_TOKEN}MONDAY_API_TOKEN=tu_token` },
    });
    expect(errorsFor(issues, "MONDAY_API_TOKEN")).toHaveLength(1);
  });

  test("a well-formed token raises nothing", () => {
    expect(errorsFor(checkEnvironment({ env: { ...DEPLOYED } }), "MONDAY_API_TOKEN")).toEqual([]);
  });

  test("never puts the token value in the message", () => {
    const issues = checkEnvironment({
      env: { ...DEPLOYED, MONDAY_API_TOKEN: "secret-value-do-not-log" },
    });
    for (const i of issues) {
      expect(i.message).not.toContain("secret-value-do-not-log");
      expect(i.fix ?? "").not.toContain("secret-value-do-not-log");
    }
  });
});

describe("regression: the 2026-06-30 localhost redirect", () => {
  // API_URL was left at localhost on the server, so Monday's OAuth callback
  // sent staff to their own machine. The endpoint kept returning 302s.
  test("flags a localhost URL in a production build", () => {
    const issues = checkEnvironment({
      env: { ...DEPLOYED, API_URL: "http://localhost:3000" },
    });
    expect(errorsFor(issues, "API_URL")).toHaveLength(1);
  });

  test("flags 127.0.0.1 the same way", () => {
    const issues = checkEnvironment({ env: { ...DEPLOYED, FRONTEND_URL: "http://127.0.0.1:5173" } });
    expect(errorsFor(issues, "FRONTEND_URL")).toHaveLength(1);
  });

  test("flags a non-https deployed origin", () => {
    const issues = checkEnvironment({ env: { ...DEPLOYED, API_URL: "http://app.example.com" } });
    expect(errorsFor(issues, "API_URL")).toHaveLength(1);
  });

  test("does NOT flag localhost on a developer machine", () => {
    // The rule that matters most: running real data locally against localhost
    // is a correct setup. A checker that fails a correct config gets ignored.
    const issues = checkEnvironment({
      env: {
        DB_SOURCE: "live",
        MONDAY_API_TOKEN: GOOD_TOKEN,
        API_URL: "http://localhost:3000",
        FRONTEND_URL: "http://localhost:5173",
        APP_ENCRYPTION_KEY: "a".repeat(64),
      },
    });
    expect(errorsFor(issues, "API_URL")).toEqual([]);
    expect(errorsFor(issues, "FRONTEND_URL")).toEqual([]);
  });

  test("flags a malformed URL anywhere", () => {
    const issues = checkEnvironment({ env: { API_URL: "not a url" } });
    expect(errorsFor(issues, "API_URL")).toHaveLength(1);
  });
});

describe("placeholders", () => {
  test("flags a value left as the .env.example stand-in", () => {
    const example = envFile("MONDAY_CLIENT_ID=your_client_id_here", ".env.example");
    const issues = checkEnvironment({
      env: { MONDAY_CLIENT_ID: "your_client_id_here", MONDAY_CLIENT_SECRET: "real" },
      examplePath: example,
    });
    expect(errorsFor(issues, "MONDAY_CLIENT_ID")).toHaveLength(1);
  });

  test("does not flag a real value that happens to match a non-placeholder example", () => {
    // API_URL genuinely equals the example in development.
    const example = envFile("API_URL=http://localhost:3000", ".env.example");
    const issues = checkEnvironment({
      env: { API_URL: "http://localhost:3000" },
      examplePath: example,
    });
    expect(errorsFor(issues, "API_URL")).toEqual([]);
  });
});

describe("half-configured OAuth", () => {
  test("a client id without a secret is an error, not a shrug", () => {
    // Half-configured OAuth makes /api/auth/monday return 503 with no other sign.
    const issues = checkEnvironment({ env: { ...DEPLOYED, MONDAY_CLIENT_ID: "abc" } });
    expect(errorsFor(issues, "MONDAY_CLIENT_SECRET")).toHaveLength(1);
  });

  test("both set is fine", () => {
    const issues = checkEnvironment({
      env: { ...DEPLOYED, MONDAY_CLIENT_ID: "abc", MONDAY_CLIENT_SECRET: "def" },
    });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("other silent faults", () => {
  test("an invalid cron expression is an error — the job would never run", () => {
    const issues = checkEnvironment({ env: { ...DEPLOYED, SYNC_FULL_CRON: "not a cron" } });
    expect(errorsFor(issues, "SYNC_FULL_CRON")).toHaveLength(1);
  });

  test("a valid cron expression passes", () => {
    const issues = checkEnvironment({ env: { ...DEPLOYED, SYNC_FULL_CRON: "0 1 * * *" } });
    expect(errorsFor(issues, "SYNC_FULL_CRON")).toEqual([]);
  });

  test("an unknown DB_SOURCE is an error", () => {
    expect(errorsFor(checkEnvironment({ env: { DB_SOURCE: "prod" } }), "DB_SOURCE")).toHaveLength(1);
  });

  test("a missing encryption key is fatal deployed, advisory locally", () => {
    const deployed = checkEnvironment({ env: { ...DEPLOYED, APP_ENCRYPTION_KEY: "" } });
    expect(errorsFor(deployed, "APP_ENCRYPTION_KEY")).toHaveLength(1);

    const local = checkEnvironment({ env: { DB_SOURCE: "seed" } });
    expect(errorsFor(local, "APP_ENCRYPTION_KEY")).toEqual([]);
    expect(local.some((i) => i.variable === "APP_ENCRYPTION_KEY" && i.level === "warning")).toBe(true);
  });

  test("a short webhook secret warns without blocking", () => {
    const issues = checkEnvironment({ env: { ...DEPLOYED, MONDAY_WEBHOOK_SECRET: "short" } });
    expect(errorsFor(issues, "MONDAY_WEBHOOK_SECRET")).toEqual([]);
    expect(issues.some((i) => i.variable === "MONDAY_WEBHOOK_SECRET" && i.level === "warning")).toBe(true);
  });

  test("a clean deployed environment produces nothing at all", () => {
    expect(checkEnvironment({ env: { ...DEPLOYED, MONDAY_CLIENT_ID: "a", MONDAY_CLIENT_SECRET: "b" } })).toEqual([]);
  });
});

describe("reportEnvironment", () => {
  const issue = (level: EnvIssue["level"]): EnvIssue => ({ level, variable: "X", message: "bad" });

  test("signals a refusal to start when there is an error", () => {
    expect(reportEnvironment([issue("error")], {})).toBe(true);
  });

  test("warnings alone never block a boot", () => {
    expect(reportEnvironment([issue("warning")], {})).toBe(false);
  });

  test("ENV_CHECK=warn downgrades errors, so a false positive can't strand a live system", () => {
    expect(reportEnvironment([issue("error")], { ENV_CHECK: "warn" })).toBe(false);
  });
});
