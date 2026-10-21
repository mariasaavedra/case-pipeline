import { describe, it, expect } from "vitest";
import {
  RateLimiter, TOKEN_RE, clientUploadsConfig, firstNameOf, hashToken, linkDays, newToken, sniffFileType, sqliteUtc, storedName,
} from "./rules.js";

const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

describe("sniffFileType: by the first bytes, never the name", () => {
  it("knows PDF, JPEG, PNG, TIFF and iPhone HEIC", () => {
    expect(sniffFileType(bytes("%PDF-1.7\n"), "x")?.ext).toBe("pdf");
    expect(sniffFileType(bytes([0xff, 0xd8, 0xff, 0xe0]), "x")?.ext).toBe("jpg");
    expect(sniffFileType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "x")?.ext).toBe("png");
    expect(sniffFileType(bytes("II*\0"), "x")?.ext).toBe("tif");
    expect(sniffFileType(bytes("MM\0*"), "x")?.ext).toBe("tif");
    expect(sniffFileType(bytes([0, 0, 0, 0x18], "ftypheic"), "IMG_1.HEIC")).toEqual({ ext: "heic", contentType: "image/heic" });
    expect(sniffFileType(bytes([0, 0, 0, 0x18], "ftypmif1"), "x")?.ext).toBe("heif");
  });

  it("a photo named .pdf is a photo; a renamed program is refused", () => {
    expect(sniffFileType(bytes([0xff, 0xd8, 0xff, 0xe1]), "scan.pdf")?.ext).toBe("jpg");
    expect(sniffFileType(bytes("MZ\x90\0"), "passport.pdf")).toBeNull();
    expect(sniffFileType(bytes("<html>"), "notice.jpg")).toBeNull();
    expect(sniffFileType(Buffer.alloc(0), "x.pdf")).toBeNull();
  });

  it("Word only with the matching name (any zip / OLE file looks the same)", () => {
    const zip = bytes([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(sniffFileType(zip, "Letter.DOCX")?.ext).toBe("docx");
    expect(sniffFileType(zip, "photos.zip")).toBeNull();
    expect(sniffFileType(ole, "old.doc")?.ext).toBe("doc");
    expect(sniffFileType(ole, "macro.xls")).toBeNull();
  });
});

describe("storedName", () => {
  const jpg = { ext: "jpg", contentType: "image/jpeg" };
  it("date + kind + the client's name, extension from the bytes", () => {
    expect(storedName("2026-10-21", "notice", "IMG_4412.HEIC", jpg)).toBe("2026-10-21 Notice - IMG_4412.jpg");
    expect(storedName("2026-10-21", "id", "pasaporte", jpg)).toBe("2026-10-21 ID - pasaporte.jpg");
  });
  it("drops what SharePoint refuses; never empty", () => {
    expect(storedName("2026-10-21", "other", "a/b:c*?\"<>|#%.pdf", { ext: "pdf", contentType: "application/pdf" }))
      .toBe("2026-10-21 Document - a b c.pdf");
    expect(storedName("2026-10-21", "evidence", "###.jpg", jpg)).toBe("2026-10-21 Evidence - file.jpg");
  });
});

describe("firstNameOf", () => {
  it("first word, title case, no A-number or honorific", () => {
    expect(firstNameOf("Yaucdy Yoselyn QUINTANILLA CASTRO")).toBe("Yaucdy");
    expect(firstNameOf("JACOBUS VAN HEERDEN")).toBe("Jacobus");
    expect(firstNameOf("[A123-456-789] Mayra TEST")).toBe("Mayra");
    expect(firstNameOf("Ms. Danielle Franecki")).toBe("Danielle");
    expect(firstNameOf("ÁNGEL ruiz")).toBe("Ángel");
    expect(firstNameOf("  ")).toBeNull();
  });
});

describe("tokens, days, config", () => {
  it("tokens are 43 url-safe characters and only their hash is kept", () => {
    const t = newToken();
    expect(TOKEN_RE.test(t)).toBe(true);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });
  it("days: 30 by default, 1–90 whole numbers only", () => {
    expect(linkDays(undefined)).toBe(30);
    expect(linkDays(7)).toBe(7);
    expect(linkDays("90")).toBe(90);
    for (const bad of [0, 91, 2.5, "x", -1]) expect(linkDays(bad)).toBeNull();
  });
  it("on only with CLIENT_UPLOADS=on and API_URL", () => {
    expect(clientUploadsConfig({ CLIENT_UPLOADS: "on", API_URL: "https://app.x.com/" })).toEqual({ publicUrl: "https://app.x.com" });
    expect(clientUploadsConfig({ CLIENT_UPLOADS: "on" })).toBeNull();
    expect(clientUploadsConfig({ CLIENT_UPLOADS: "off", API_URL: "https://app.x.com" })).toBeNull();
  });
  it("sqliteUtc matches datetime('now')", () => {
    expect(sqliteUtc(new Date("2026-10-21T15:04:05.678Z"))).toBe("2026-10-21 15:04:05");
  });
});

describe("RateLimiter", () => {
  it("allows max per window per key, then again once the window passes", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(true);
    expect(rl.allow("a", 20)).toBe(false);
    expect(rl.allow("b", 20)).toBe(true);
    expect(rl.allow("a", 1001)).toBe(true);
  });
});
