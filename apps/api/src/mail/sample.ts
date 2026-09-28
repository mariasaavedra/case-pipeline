// =============================================================================
// Fake scanned-mail PDF — for trying the Mail page without real mail
// =============================================================================
// Builds ONE multi-page PDF, the way a front desk would scan a day's mail in a
// single pass, from whatever database the API has loaded. Using real rows is
// the point: the identifiers on the fake notices then match (or deliberately
// miss) actual Open Forms, so every outcome on the Mail page shows up.
//
// Every page is stamped SAMPLE. These are test fixtures, not USCIS documents.
//
//   pages 1-2  receipt notice, new receipt no.  → matched, fill Receipt No.
//   page  3    approval, receipt already on file → matched, attach (live data only)
//   page  4    notice for a form the client lacks → needs attention
//   page  5    receipt notice with NO A-number  → matched by the beneficiary's name
//   page  6    A-number nobody has              → no match
//   page  7    blank separator sheet            → dropped
//   page  8    letter with no identifiers       → unreadable
//
// Notices are laid out like a real I-797C: a grid of labels with each value
// printed BELOW its label (Receipt Number / Case Type; Received / Priority /
// Notice Date / Page; Petitioner / Beneficiary), which is what the layout
// reader in libs/query/src/mail-layout.ts has to handle.
//
// buildScannedSampleMailPdf renders those same pages to images and rebuilds the
// PDF from the pictures alone — no text layer, like a plain scanner — so every
// page has to go through OCR.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { findFormsForProfile, type MatchedOpenForm } from "@case-pipeline/query";

type Database = BetterSqlite3.Database;

interface ProfileRow {
  localId: string;
  name: string;
  aNumber: string;
}

/** Helvetica only encodes WinAnsi; strip anything else rather than throw. */
function ascii(s: string): string {
  return s.normalize("NFD").replace(/[^\x20-\x7E]/g, "");
}

function formatA(aNumber: string): string {
  const d = aNumber.replace(/\D/g, "").padStart(9, "0");
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Stable per profile, so regenerating gives the same numbers. */
function fakeReceipt(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `IOE09${String(h % 100_000_000).padStart(8, "0")}`;
}

interface Picks {
  fill: { profile: ProfileRow; form: MatchedOpenForm } | null;
  byName: { profile: ProfileRow; form: MatchedOpenForm } | null;
  attach: { profile: ProfileRow | null; form: MatchedOpenForm } | null;
  missingForm: { profile: ProfileRow; formType: string } | null;
  unknownA: string;
}

function pick(db: Database): Picks {
  const profiles = db
    .prepare(
      `SELECT local_id AS localId, name, a_number AS aNumber FROM profiles
       WHERE deleted_at IS NULL AND a_number IS NOT NULL AND trim(a_number) <> ''
       ORDER BY name LIMIT 2000`,
    )
    .all() as ProfileRow[];

  const countStmt = db.prepare(
    `SELECT count(*) AS n FROM board_items
     WHERE board_key = '_cd_open_forms' AND deleted_at IS NULL
       AND upper(replace(json_extract(column_values, '$.receipt_no'), ' ', '')) = ?`,
  );
  const receiptCount = (r: string) => (countStmt.get(r) as { n: number }).n;

  const picks: Picks = { fill: null, byName: null, attach: null, missingForm: null, unknownA: "" };
  for (const p of profiles) {
    if (picks.fill && picks.byName && picks.attach && picks.missingForm) break;
    const forms = findFormsForProfile(db, p.localId);
    if (forms.length === 0) continue;

    if (!picks.fill || !picks.byName) {
      const candidate = forms.find(
        (f) => f.formType && !f.receiptNo && forms.filter((g) => g.formType === f.formType).length === 1,
      );
      // The name-only notice needs a name no other client shares.
      const uniqueName = profiles.filter((q) => q.name === p.name).length === 1;
      if (candidate && !picks.fill) {
        picks.fill = { profile: p, form: candidate };
        continue;
      }
      if (candidate && !picks.byName && uniqueName) {
        picks.byName = { profile: p, form: candidate };
        continue;
      }
    }
    if (!picks.attach) {
      // Receipt numbers are sometimes copied onto a second Open Form; that is a
      // real conflict, but this page is meant to show the clean case.
      const withReceipt = forms.find((f) => f.receiptNo && f.formType && receiptCount(f.receiptNo) === 1);
      if (withReceipt) {
        picks.attach = { profile: p, form: withReceipt };
        continue;
      }
    }
    if (!picks.missingForm) {
      const lacking = ["I765", "I912", "I131", "I864"].find((t) => !forms.some((f) => f.formType === t));
      if (lacking) picks.missingForm = { profile: p, formType: lacking };
    }
  }

  const taken = new Set(profiles.map((p) => p.aNumber.replace(/\D/g, "").replace(/^0+/, "")));
  let n = 912_345_670;
  while (taken.has(String(n))) n++;
  picks.unknownA = String(n);
  return picks;
}

class Writer {
  private y = 740;
  constructor(
    private page: PDFPage,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    // Diagonal watermark, so nobody mistakes a printout for a real notice.
    page.drawText("SAMPLE - NOT A REAL DOCUMENT", {
      x: 110,
      y: 250,
      size: 34,
      font: bold,
      color: rgb(0.85, 0.85, 0.85),
      rotate: degrees(35),
    });
  }
  /** One row of cells at fixed x positions — how an I-797's grid is printed. */
  row(cells: Array<[number, string]>, opts: { size?: number; bold?: boolean; gap?: number } = {}): this {
    for (const [x, text] of cells) {
      if (!text) continue;
      this.page.drawText(ascii(text), {
        x,
        y: this.y,
        size: opts.size ?? 10,
        font: opts.bold ? this.bold : this.font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    this.y -= opts.gap ?? 15;
    return this;
  }
  line(text: string, opts: { size?: number; bold?: boolean; gap?: number } = {}): this {
    this.page.drawText(ascii(text), {
      x: 56,
      y: this.y,
      size: opts.size ?? 10.5,
      font: opts.bold ? this.bold : this.font,
      color: rgb(0.1, 0.1, 0.1),
    });
    this.y -= opts.gap ?? 17;
    return this;
  }
  space(h = 10): this {
    this.y -= h;
    return this;
  }
}

const CASE_TYPES: Record<string, string> = {
  I130: "PETITION FOR ALIEN RELATIVE",
  I131: "APPLICATION FOR TRAVEL DOCUMENT",
  I485: "APPLICATION TO ADJUST STATUS",
  I589: "APPLICATION FOR ASYLUM",
  I601: "APPLICATION FOR WAIVER",
  I765: "APPLICATION FOR WORK PERMIT",
  I864: "AFFIDAVIT OF SUPPORT",
  I912: "REQUEST FOR FEE WAIVER",
  N400: "APPLICATION FOR NATURALIZATION",
};

/** "Ms. Danielle Franecki" → "FRANECKI, DANIELLE", the way USCIS prints names. */
function noticeName(name: string): string {
  const words = ascii(name)
    .replace(/\b(Mr|Mrs|Ms|Miss|Dr|MD|Jr|Sr|II|III|IV|DDS|DVM|PhD)\.?(?=\s|$)/gi, "")
    .trim()
    .split(/\s+/);
  if (words.length < 2) return words.join(" ").toUpperCase();
  const last = words.pop()!;
  return `${last}, ${words.join(" ")}`.toUpperCase();
}

function i797(
  w: Writer,
  o: {
    receipt: string;
    formType: string;
    noticeType: string;
    date: string;
    received?: string;
    name: string;
    aNumber: string;
    page?: string;
  },
): void {
  // Column x positions, as on a real I-797C.
  const [c1, c2, c3, c4] = [56, 180, 300, 430];
  w.line("SAMPLE FIXTURE - Department of Homeland Security", { size: 8, gap: 14 })
    .line("I-797C, Notice of Action", { size: 15, bold: true, gap: 26 })
    .row([[c1, "Receipt Number"], [c3, "Case Type"]], { size: 8, gap: 12 })
    .row([[c1, o.receipt], [c3, `${o.formType} - ${CASE_TYPES[o.formType] ?? "APPLICATION"}`]], { gap: 20 })
    .row([[c1, "Received Date"], [c2, "Priority Date"], [c3, "Notice Date"], [c4, "Page"]], { size: 8, gap: 12 })
    // Priority Date is left blank, as it is on most receipt notices.
    .row([[c1, o.received ?? "09/15/2026"], [c3, o.date], [c4, o.page ?? "1 of 1"]], { gap: 20 })
    .row([[c1, "Petitioner"], [c3, "Beneficiary"]], { size: 8, gap: 12 })
    .row([[c1, "DOE, SAMPLE"], [c3, noticeName(o.name)]], { gap: 12 })
    .row([[c3, o.aNumber ? `A# ${formatA(o.aNumber)}` : ""]], { gap: 20 })
    .line(`Notice Type: ${o.noticeType}`)
    .space(14);
}

export async function buildSampleMailPdf(db: Database): Promise<Uint8Array> {
  const picks = pick(db);
  const doc = await PDFDocument.create();
  doc.setTitle("Sample scanned mail");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = () => new Writer(doc.addPage([612, 792]), font, bold);

  // 1-2: a 2-page receipt notice carrying a NEW receipt number.
  if (picks.fill) {
    const { profile, form } = picks.fill;
    const receipt = fakeReceipt(profile.localId);
    const p1 = page();
    i797(p1, {
      receipt,
      formType: form.formType!,
      noticeType: "Receipt Notice",
      date: "09/22/2026",
      name: profile.name,
      aNumber: profile.aNumber,
      page: "1 of 2",
    });
    p1.line("We have received your form and fee. This notice confirms receipt only.")
      .line("Processing times vary. Keep this notice for your records.")
      .space(250);
    page()
      .row([[56, "Page"]], { size: 8, gap: 12 })
      .row([[56, "2 of 2"]], { gap: 24 })
      .line("What to expect next", { bold: true, gap: 22 })
      .line("You will receive a separate notice if an appointment is required.")
      .line("Use the online account to check your case status at any time.")
      .space(20);
  }

  // 3: approval notice for a receipt number the firm already has.
  if (picks.attach) {
    const { profile, form } = picks.attach;
    const p = page();
    i797(p, {
      receipt: form.receiptNo!,
      formType: form.formType!,
      noticeType: "Approval Notice",
      date: "09/23/2026",
      name: profile?.name ?? form.name,
      aNumber: profile?.aNumber ?? "",
    });
    p.line("The above petition has been approved.");
  }

  // 4: biometrics for a form type the client has no Open Form for.
  if (picks.missingForm) {
    const { profile, formType } = picks.missingForm;
    const p = page();
    i797(p, {
      receipt: fakeReceipt(`${profile.localId}-bio`),
      formType,
      noticeType: "Biometrics Appointment",
      date: "09/24/2026",
      name: profile.name,
      aNumber: profile.aNumber,
    });
    p.line("You are scheduled for a biometric services appointment.");
  }

  // 5: a first-time beneficiary — no A-number on the notice, only the name.
  if (picks.byName) {
    const { profile, form } = picks.byName;
    i797(page(), {
      receipt: fakeReceipt(`${profile.localId}-name`),
      formType: form.formType!,
      noticeType: "Receipt Notice",
      date: "09/24/2026",
      received: "09/16/2026",
      name: profile.name,
      aNumber: "",
    });
  }

  // 6: nobody at the firm has this A-number.
  i797(page(), {
    receipt: "MSC2690000417",
    formType: "I485",
    noticeType: "Receipt Notice",
    date: "09/24/2026",
    name: "Sample Unknown Person",
    aNumber: picks.unknownA,
  });

  // 6: blank separator sheet — added bare, because the watermark is real text
  // and would stop it reading as blank.
  doc.addPage([612, 792]);

  // 7: ordinary letter, no identifiers.
  page()
    .line("SAMPLE FIXTURE - Letter", { size: 8, gap: 20 })
    .line("Dear Attorney,", { gap: 22 })
    .line("I am writing about my brother's case. He moved to a new address last")
    .line("month and wanted to make sure the office has it. Please call me back.")
    .space()
    .line("Thank you,")
    .line("A family member");

  return doc.save();
}

/** Scanner resolution for the image-only variant. 200 DPI is a common default. */
const SCAN_DPI = 200;

export async function buildScannedSampleMailPdf(db: Database): Promise<Uint8Array> {
  const textPdf = await buildSampleMailPdf(db);
  const source = await getDocumentProxy(textPdf.slice());
  const out = await PDFDocument.create();
  out.setTitle("Sample scanned mail (image only)");

  for (let n = 1; n <= source.numPages; n++) {
    const png = await renderPageAsImage(source, n, {
      scale: SCAN_DPI / 72,
      canvasImport: () => import("@napi-rs/canvas"),
    });
    const image = await out.embedPng(png);
    const page = out.addPage([612, 792]);
    // A real feeder never lands a sheet perfectly square; a slight skew keeps
    // the OCR honest.
    page.drawImage(image, { x: 4, y: -2, width: 612, height: 792, rotate: degrees(n % 2 ? 0.4 : -0.3) });
  }
  return out.save();
}
