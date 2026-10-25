// =============================================================================
// Client uploads — making files easy to open (docs/features/buzon.md, Phase 3)
// =============================================================================
// Used by the filing script before a file goes to SharePoint:
//   - an iPhone photo (HEIC / HEIF) becomes a JPG, so every office PC opens it;
//   - several photos sent for ONE checklist document in one batch (front and
//     back of an ID, the pages of a birth certificate) become one PDF, one page
//     each, in the order they came.
// The originals stay in data/uploads until the usual 30-day clean-up.
// Not done: cropping / straightening a photo of paper.
// =============================================================================

import { PDFDocument } from "pdf-lib";

export interface FileBytes {
  bytes: Buffer;
  contentType: string;
  name: string;
}

export const isHeic = (contentType: string) => contentType === "image/heic" || contentType === "image/heif";
/** Photos that can be pages of a combined PDF (HEIC after conversion). */
export const isPageImage = (contentType: string) => contentType === "image/jpeg" || contentType === "image/png" || isHeic(contentType);

/** "IMG_4412.heic" → "IMG_4412.jpg" (and the same for "… - x.heif"). */
export const jpgName = (name: string) => name.replace(/\.(heic|heif)$/i, "") + ".jpg";

/** HEIC / HEIF → JPEG (pure JS, no system libraries). */
export async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  // heic-convert ships no types; the name in a variable keeps tsc from looking for them.
  const pkg = "heic-convert";
  const { default: convert } = (await import(pkg)) as {
    default: (o: { buffer: Buffer | ArrayBuffer; format: "JPEG" | "PNG"; quality?: number }) => Promise<ArrayBuffer>;
  };
  return Buffer.from(await convert({ buffer: bytes, format: "JPEG", quality: 0.9 }));
}

/** A file ready to open anywhere: HEIC becomes JPG, everything else as it is. */
export async function openable(f: FileBytes): Promise<FileBytes> {
  if (!isHeic(f.contentType)) return f;
  return { bytes: await heicToJpeg(f.bytes), contentType: "image/jpeg", name: jpgName(f.name) };
}

const LETTER: [number, number] = [612, 792];
const MARGIN = 18;

/** JPG / PNG photos → one PDF, one Letter page each, the photo scaled to fit and centred. */
export async function imagesToPdf(images: FileBytes[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.contentType === "image/png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
    // A landscape photo gets a landscape page.
    const [w, h] = embedded.width > embedded.height ? [LETTER[1], LETTER[0]] : LETTER;
    const scale = Math.min((w - 2 * MARGIN) / embedded.width, (h - 2 * MARGIN) / embedded.height, 1);
    const page = pdf.addPage([w, h]);
    page.drawImage(embedded, {
      x: (w - embedded.width * scale) / 2,
      y: (h - embedded.height * scale) / 2,
      width: embedded.width * scale,
      height: embedded.height * scale,
    });
  }
  return Buffer.from(await pdf.save());
}

/** What goes up as one SharePoint file: one upload, or several photos joined into one PDF. */
export interface Unit<R> {
  rows: R[];
  name: string;
}

/**
 * Several photos for one checklist document in one batch → one PDF; everything
 * else goes up on its own (HEIC named .jpg). In the order they came.
 */
export function toUnits<R extends { id: number; item_id: number | null; content_type: string; stored_name: string }>(rows: R[]): Unit<R>[] {
  const units: Unit<R>[] = [];
  const photos = new Map<number, R[]>();
  const own = (r: R): Unit<R> => ({ rows: [r], name: isHeic(r.content_type) ? jpgName(r.stored_name) : r.stored_name });
  for (const r of rows) {
    if (r.item_id !== null && isPageImage(r.content_type)) photos.set(r.item_id, [...(photos.get(r.item_id) ?? []), r]);
    else units.push(own(r));
  }
  for (const group of photos.values()) {
    units.push(group.length > 1 ? { rows: group, name: combinedName(group[0]!.stored_name, group.length) } : own(group[0]!));
  }
  return units.sort((a, b) => a.rows[0]!.id - b.rows[0]!.id);
}

/**
 * The combined PDF's name, from the first photo's stored name:
 * "2026-10-24 Passport - IMG_1.jpg" + 2 pages → "2026-10-24 Passport - 2 pages.pdf".
 */
export function combinedName(firstStoredName: string, pages: number): string {
  const prefix = firstStoredName.replace(/ - [^-]*$/, "");
  return `${prefix} - ${pages} pages.pdf`;
}
