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
//   page  5    A-number nobody has              → no match
//   page  6    blank separator sheet            → dropped
//   page  7    letter with no identifiers       → unreadable
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
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

function formLabel(f: string): string {
  return `${f[0]}-${f.slice(1)}`;
}

/** Stable per profile, so regenerating gives the same numbers. */
function fakeReceipt(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `IOE09${String(h % 100_000_000).padStart(8, "0")}`;
}

interface Picks {
  fill: { profile: ProfileRow; form: MatchedOpenForm } | null;
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

  const picks: Picks = { fill: null, attach: null, missingForm: null, unknownA: "" };
  for (const p of profiles) {
    if (picks.fill && picks.attach && picks.missingForm) break;
    const forms = findFormsForProfile(db, p.localId);
    if (forms.length === 0) continue;

    if (!picks.fill) {
      const candidate = forms.find(
        (f) => f.formType && !f.receiptNo && forms.filter((g) => g.formType === f.formType).length === 1,
      );
      if (candidate) {
        picks.fill = { profile: p, form: candidate };
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

function i797(
  w: Writer,
  o: { receipt: string; formType: string; noticeType: string; date: string; name: string; aNumber: string; page?: string },
): void {
  w.line("SAMPLE FIXTURE - Department of Homeland Security", { size: 8, gap: 14 })
    .line("I-797C, Notice of Action", { size: 15, bold: true, gap: 26 })
    .line(`Receipt Number: ${o.receipt}          Case Type: ${formLabel(o.formType)}`)
    .line(`Notice Date: ${o.date}          Notice Type: ${o.noticeType}`)
    .space()
    .line(`Applicant: ${o.name.toUpperCase()}`)
    .line(`A# ${formatA(o.aNumber)}`)
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
      date: "September 22, 2026",
      name: profile.name,
      aNumber: profile.aNumber,
    });
    p1.line("We have received your form and fee. This notice confirms receipt only.")
      .line("Processing times vary. Keep this notice for your records.")
      .space(300)
      .line("Page 1 of 2", { size: 9 });
    page()
      .line("What to expect next", { bold: true, gap: 22 })
      .line("You will receive a separate notice if an appointment is required.")
      .line("Use the online account to check your case status at any time.")
      .space(420)
      .line("Page 2 of 2", { size: 9 });
  }

  // 3: approval notice for a receipt number the firm already has.
  if (picks.attach) {
    const { profile, form } = picks.attach;
    const p = page();
    i797(p, {
      receipt: form.receiptNo!,
      formType: form.formType!,
      noticeType: "Approval Notice",
      date: "September 23, 2026",
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
      date: "September 24, 2026",
      name: profile.name,
      aNumber: profile.aNumber,
    });
    p.line("You are scheduled for a biometric services appointment.");
  }

  // 5: nobody at the firm has this A-number.
  i797(page(), {
    receipt: "MSC2690000417",
    formType: "I485",
    noticeType: "Receipt Notice",
    date: "September 24, 2026",
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
