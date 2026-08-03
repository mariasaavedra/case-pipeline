// =============================================================================
// Build stamp — which build of the web app is actually running
// =============================================================================
// Values are injected by Vite `define` at build time (see vite.config.ts);
// Dockerfile.web supplies BUILD_SHA / BUILD_DATE from the CI commit. In local
// dev they fall back to "dev"/now, so the badge always renders something.
// =============================================================================

declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

export const BUILD_SHA: string = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev";
export const BUILD_DATE: string = typeof __BUILD_DATE__ !== "undefined" && __BUILD_DATE__ ? __BUILD_DATE__ : "";

/** Short 7-char SHA, or "dev" for local builds. */
export const SHORT_SHA: string = BUILD_SHA === "dev" ? "dev" : BUILD_SHA.slice(0, 7);

/** Human date (YYYY-MM-DD) of the build, or "" if unknown. */
export const BUILD_DAY: string = BUILD_DATE ? BUILD_DATE.slice(0, 10) : "";

/** One-line label, e.g. "1a2b3c4 · 2026-07-30". */
export const VERSION_LABEL: string = [SHORT_SHA, BUILD_DAY].filter(Boolean).join(" · ");
