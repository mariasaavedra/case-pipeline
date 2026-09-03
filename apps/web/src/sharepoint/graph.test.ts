import { describe, it, expect, vi } from "vitest";

// graph.ts reaches for MSAL at module load; none of it is needed to check how
// request URLs are built.
vi.mock("../auth/AuthProvider", () => ({ msalInstance: { getActiveAccount: () => null, getAllAccounts: () => [] } }));
vi.mock("../auth/msal-config", () => ({ graphRequest: { scopes: [] } }));

const { siteRequestPath, driveItemRequestPath, encodeSharingUrl } = await import("./graph");

/** How many ":" path-addressed segments a Graph URL uses. More than one is invalid. */
function colonSegments(path: string): number {
  return (path.match(/:(?=\/|$)/g) ?? []).length;
}

describe("Graph request paths", () => {
  it("addresses a site by path", () => {
    expect(siteRequestPath("sharmacrawford.sharepoint.com", "/sites/scalconsults")).toBe(
      "/sites/sharmacrawford.sharepoint.com:/sites/scalconsults",
    );
  });

  it("addresses an item inside a known drive", () => {
    expect(driveItemRequestPath("drive1", "2026 Consults/D/DE LA O, Karla")).toBe(
      "/drives/drive1/root:/2026%20Consults/D/DE%20LA%20O%2C%20Karla",
    );
  });

  it("uses the plain root when there is no sub-path", () => {
    expect(driveItemRequestPath("drive1", "")).toBe("/drives/drive1/root");
  });

  it("NEVER chains two path-addressed segments", () => {
    // The bug this replaced: /sites/{host}:{sitePath}:/drive/root:/{itemPath}
    // returns 400 "Resource not found for the segment 'root:'". Graph allows a
    // single colon-addressed segment per URL, so the site must be resolved to an
    // id before the item path is used.
    expect(colonSegments(siteRequestPath("host.sharepoint.com", "/sites/x"))).toBe(1);
    expect(colonSegments(driveItemRequestPath("d", "a/b/c"))).toBe(1);
    expect(colonSegments(driveItemRequestPath("d", ""))).toBe(0);
  });

  it("percent-encodes each segment but keeps the separators", () => {
    const path = driveItemRequestPath("d", "2025 Consults/M/MUÑOZ, José");
    expect(path.split("/").length).toBe(7); // "", drives, d, root:, 2025…, M, MUÑOZ…
    expect(path).toContain("MU%C3%91OZ%2C%20Jos%C3%A9");
  });

  it("base64url-encodes a sharing URL for /shares", () => {
    expect(encodeSharingUrl("https://a.sharepoint.com/:f:/s/x/Abc?e=1")).toMatch(/^u![A-Za-z0-9_-]+$/);
  });
});
