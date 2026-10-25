import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { combinedName, imagesToPdf, isPageImage, jpgName, openable, toUnits } from "./convert.js";

// A 1×1 PNG and a 2×1 PNG (landscape).
const PNG_1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe("convert", () => {
  it("photos become one PDF, one page each", async () => {
    const pdf = await imagesToPdf([
      { bytes: PNG_1, contentType: "image/png", name: "a.png" },
      { bytes: PNG_1, contentType: "image/png", name: "b.png" },
    ]);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it("names: HEIC → .jpg; combined PDF keeps the date and document", () => {
    expect(jpgName("2026-10-24 Passport - IMG_1.heic")).toBe("2026-10-24 Passport - IMG_1.jpg");
    expect(combinedName("2026-10-24 Birth certificate - IMG_1.jpg", 3)).toBe("2026-10-24 Birth certificate - 3 pages.pdf");
  });

  it("units: photos for one document in a batch become one PDF; a PDF, a lone photo and free uploads go alone", () => {
    const r = (id: number, item: number | null, type: string, name: string) => ({ id, item_id: item, content_type: type, stored_name: name });
    const units = toUnits([
      r(1, 5, "image/jpeg", "2026-10-24 Passport - front.jpg"),
      r(2, 6, "application/pdf", "2026-10-24 Birth certificate - acta.pdf"),
      r(3, 5, "image/heic", "2026-10-24 Passport - back.heic"),
      r(4, null, "image/heic", "2026-10-24 Notice - IMG_9.heic"),
      r(5, 7, "image/heic", "2026-10-24 Marriage certificate - IMG_2.heic"),
    ]);
    expect(units.map((u) => [u.rows.map((x) => x.id), u.name])).toEqual([
      [[1, 3], "2026-10-24 Passport - 2 pages.pdf"],
      [[2], "2026-10-24 Birth certificate - acta.pdf"],
      [[4], "2026-10-24 Notice - IMG_9.jpg"],
      [[5], "2026-10-24 Marriage certificate - IMG_2.jpg"],
    ]);
  });

  it("which files are pages; a PDF passes through untouched", async () => {
    expect(["image/jpeg", "image/png", "image/heic", "application/pdf"].map(isPageImage)).toEqual([true, true, true, false]);
    const f = { bytes: Buffer.from("%PDF-1.7"), contentType: "application/pdf", name: "a.pdf" };
    expect(await openable(f)).toBe(f);
  });
});
