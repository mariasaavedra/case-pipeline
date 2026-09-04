// =============================================================================
// Environment validation
// =============================================================================
// Every check here exists because the corresponding misconfiguration once ran
// in production, undetected, for hours or days. The pattern is always the same:
// a value is wrong in a way that produces no error, so the app boots, reports
// itself healthy, and quietly does the wrong thing.
//
//   2026-06-30 — API_URL left at localhost on the server. Staff clicking
//                "Connect Monday" were redirected to a machine that wasn't
//                theirs. Nothing logged; the endpoint returned a 302 as always.
//   2026-08-07 — .env carried MONDAY_API_TOKEN twice, the second line pasted
//                with the .env.example placeholder glued to the end. The last
//                definition wins, so the effective token was garbage. Every
//                write failed with a 401 that only the write queue ever saw.
//
// The rule this module encodes: a configuration value that is *silently* wrong
// is worse than one that is loudly absent. Prefer refusing to boot.
//
// Nothing here ever logs a value — only the variable name and the shape
// problem. A config checker that prints secrets to the deploy log has traded
// one class of incident for a worse one.
// =============================================================================

import fs from "node:fs";
import cron from "node-cron";

export type IssueLevel = "error" | "warning";

export interface EnvIssue {
  level: IssueLevel;
  variable: string;
  /** What is wrong. Never contains the value itself. */
  message: string;
  /** What to do about it. */
  fix?: string;
}

export interface CheckOptions {
  env?: NodeJS.ProcessEnv;
  /** Path to the .env file, read only to detect duplicate keys. */
  envFilePath?: string | null;
  /** Path to .env.example, read only to detect unchanged placeholders. */
  examplePath?: string | null;
}

const PLACEHOLDER_RE = /^(your_|tu_|changeme|xxx+$|<.*>$)/i;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Parse `KEY=value` lines, preserving duplicates so they can be reported. */
function parseEnvFile(text: string): { key: string; value: string; line: number }[] {
  const out: { key: string; value: string; line: number }[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq <= 0) return;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    out.push({ key, value: line.slice(eq + 1).trim().replace(/^["']|["']$/g, ""), line: i + 1 });
  });
  return out;
}

export function checkEnvironment(opts: CheckOptions = {}): EnvIssue[] {
  const env = opts.env ?? process.env;
  const issues: EnvIssue[] = [];
  const err = (variable: string, message: string, fix?: string) =>
    issues.push({ level: "error", variable, message, fix });
  const warn = (variable: string, message: string, fix?: string) =>
    issues.push({ level: "warning", variable, message, fix });

  // "Deployed" is NODE_ENV=production (set by docker-compose), NOT DB_SOURCE=live.
  // Running the real database locally against localhost URLs is a normal
  // development setup — gating the URL rules on DB_SOURCE would have failed a
  // correct laptop config, which is how a checker teaches people to ignore it.
  const isDeployed = env.NODE_ENV === "production";

  // ---------------------------------------------------------------------------
  // Duplicate keys in .env — the 2026-08-07 failure
  // ---------------------------------------------------------------------------
  // Both Node's --env-file and dotenv let the LAST definition win, silently. A
  // duplicate is never intentional and the winner is never obvious by reading.
  if (opts.envFilePath && fs.existsSync(opts.envFilePath)) {
    const entries = parseEnvFile(fs.readFileSync(opts.envFilePath, "utf8"));
    const seen = new Map<string, number[]>();
    for (const e of entries) {
      seen.set(e.key, [...(seen.get(e.key) ?? []), e.line]);
    }
    for (const [key, lines] of seen) {
      if (lines.length > 1) {
        err(
          key,
          `defined ${lines.length} times in .env (lines ${lines.join(", ")}); the last one silently wins`,
          `Delete the duplicates and keep one definition.`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Unchanged placeholders
  // ---------------------------------------------------------------------------
  const examples = new Map<string, string>();
  if (opts.examplePath && fs.existsSync(opts.examplePath)) {
    for (const e of parseEnvFile(fs.readFileSync(opts.examplePath, "utf8"))) {
      examples.set(e.key, e.value);
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value || !examples.has(key)) continue;
    const example = examples.get(key)!;
    // Matching the example is only suspicious when the example is a stand-in;
    // API_URL legitimately equals http://localhost:3000 in development.
    if (value === example && PLACEHOLDER_RE.test(example)) {
      err(key, "still set to the placeholder from .env.example", "Set a real value.");
    } else if (PLACEHOLDER_RE.test(value)) {
      err(key, "looks like a placeholder, not a real value", "Set a real value.");
    }
  }

  // ---------------------------------------------------------------------------
  // DB_SOURCE
  // ---------------------------------------------------------------------------
  const dbSource = env.DB_SOURCE;
  if (dbSource && dbSource !== "seed" && dbSource !== "live") {
    err("DB_SOURCE", `must be "seed" or "live"`, `Unset it to default to "seed".`);
  }

  // ---------------------------------------------------------------------------
  // MONDAY_API_TOKEN — shape only, never the value
  // ---------------------------------------------------------------------------
  const token = env.MONDAY_API_TOKEN?.trim();
  if (!token) {
    (isDeployed ? err : warn)(
      "MONDAY_API_TOKEN",
      "not set — every Monday write-back and sync is disabled",
      "Set the shared service token.",
    );
  } else if (!JWT_RE.test(token)) {
    // Exactly the 2026-08-07 case: a valid token with a stray placeholder
    // concatenated onto it still "looks set" but is not a JWT.
    err(
      "MONDAY_API_TOKEN",
      "is not a well-formed Monday token (expected three dot-separated segments)",
      "Check for a truncated paste, a stray newline, or two values run together on one line.",
    );
  }

  // ---------------------------------------------------------------------------
  // URLs — the 2026-06-30 failure
  // ---------------------------------------------------------------------------
  for (const key of ["API_URL", "FRONTEND_URL"] as const) {
    const raw = env[key]?.trim();
    if (!raw) {
      if (isDeployed) err(key, "not set — OAuth redirects will point at a default localhost", "Set the public origin.");
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      err(key, "is not a valid URL", "Use a full origin, e.g. https://app.example.com");
      continue;
    }
    if (isDeployed) {
      const localish = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
      if (localish) {
        err(
          key,
          "points at localhost in a production build — Monday OAuth will redirect staff to their own machine",
          "Set it to the public origin of the deployed app.",
        );
      } else if (url.protocol !== "https:") {
        err(key, "is not https in a production build", "Use https for the deployed origin.");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Monday OAuth pair — half-configured means a silent 503
  // ---------------------------------------------------------------------------
  const hasId = !!env.MONDAY_CLIENT_ID?.trim();
  const hasSecret = !!env.MONDAY_CLIENT_SECRET?.trim();
  if (hasId !== hasSecret) {
    err(
      hasId ? "MONDAY_CLIENT_SECRET" : "MONDAY_CLIENT_ID",
      "is missing while its counterpart is set — personal Monday connections will fail",
      "Set both, or neither.",
    );
  } else if (!hasId && isDeployed) {
    warn(
      "MONDAY_CLIENT_ID",
      "not set — staff cannot connect personal Monday accounts, so every write is attributed to the shared account",
    );
  }

  // ---------------------------------------------------------------------------
  // Secrets at rest
  // ---------------------------------------------------------------------------
  if (!env.APP_ENCRYPTION_KEY?.trim()) {
    (isDeployed ? err : warn)(
      "APP_ENCRYPTION_KEY",
      "not set — per-user Monday tokens are stored in plaintext in users.db",
      "Generate one with: openssl rand -base64 48",
    );
  }
  if (isDeployed && !env.BACKUP_ENCRYPTION_KEY?.trim()) {
    warn("BACKUP_ENCRYPTION_KEY", "not set — database backups are written unencrypted");
  }

  // ---------------------------------------------------------------------------
  // Webhook secret — it travels in the URL path
  // ---------------------------------------------------------------------------
  const webhookSecret = env.MONDAY_WEBHOOK_SECRET?.trim();
  if (webhookSecret && webhookSecret.length < 24) {
    warn(
      "MONDAY_WEBHOOK_SECRET",
      `is short (${webhookSecret.length} chars) — it is the only thing authenticating the webhook endpoint`,
      "Use at least 32 characters: openssl rand -hex 24",
    );
  }

  // ---------------------------------------------------------------------------
  // Cron expressions — an invalid one means the job silently never runs
  // ---------------------------------------------------------------------------
  for (const key of [
    "SYNC_FULL_CRON",
    "SYNC_INCREMENTAL_CRON",
    "BACKUP_CRON",
    "CONSULT_SWEEP_CRON",
  ] as const) {
    const expr = env[key]?.trim();
    if (expr && !cron.validate(expr)) {
      err(key, "is not a valid cron expression — the job would never run", "Check the five-field syntax.");
    }
  }

  return issues;
}

/**
 * Log the findings. Returns true when the process should refuse to start.
 *
 * `ENV_CHECK=warn` downgrades errors to warnings — an escape hatch so a false
 * positive here can never be the reason a live system cannot come back up at
 * three in the morning. It is meant to be used once, loudly, and then removed.
 */
export function reportEnvironment(issues: EnvIssue[], env: NodeJS.ProcessEnv = process.env): boolean {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  for (const w of warnings) {
    console.warn(`[config] WARNING  ${w.variable}: ${w.message}${w.fix ? `\n           → ${w.fix}` : ""}`);
  }
  for (const e of errors) {
    console.error(`[config] ERROR    ${e.variable}: ${e.message}${e.fix ? `\n           → ${e.fix}` : ""}`);
  }

  if (errors.length === 0) {
    if (warnings.length === 0) console.log("[config] Environment OK.");
    return false;
  }

  if (env.ENV_CHECK === "warn") {
    console.error(
      `[config] ${errors.length} configuration error(s) — continuing anyway because ENV_CHECK=warn. ` +
        `Fix them and remove ENV_CHECK.`,
    );
    return false;
  }

  console.error(
    `[config] Refusing to start with ${errors.length} configuration error(s). ` +
      `Each one above is a fault that would otherwise run silently. ` +
      `Set ENV_CHECK=warn to override in an emergency.`,
  );
  return true;
}
