// =============================================================================
// P6 case card write tests
// =============================================================================
// What matters: only allowlisted fields, status labels Monday really has,
// real dates (and no future "Reminder sent" / "Evidence received"), a value
// changed on Monday since the card opened is refused, and an E-File link is
// only set where none is — never over a link set in Monday meanwhile.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardColumns } from "@case-pipeline/query";
import { planCaseFieldWrite, planEFileWrite, type CaseFieldItem } from "./case-card-write";

const TODAY = "2026-10-14";

const FEE_SCHEMA: BoardColumns = {
  boardKey: "fee_ks",
  mondayBoardId: "4880153390",
  columns: [
    { columnId: "status6__1", title: "PS Stage", type: "status", options: [{ label: "Need Evidence" }, { label: "Evidence Received" }], position: 0 },
    { columnId: "date_mkzktfv1", title: "Reminder Sent/Checked on...", type: "date", options: [], position: 1 },
    { columnId: "date_mkx8stcx", title: "Evidence Received Date", type: "date", options: [], position: 2 },
  ] as BoardColumns["columns"],
};

const FORM_SCHEMA: BoardColumns = {
  boardKey: "_cd_open_forms",
  mondayBoardId: "8025566986",
  columns: [
    { columnId: "project_status", title: "Status", type: "status", options: [{ label: "Needs Forms Appt" }, { label: "Forms Appt Scheduled" }], position: 0 },
    { columnId: "date_mkkwqnd4", title: "Forms Appt Date", type: "date", options: [], position: 1 },
  ] as BoardColumns["columns"],
};

const item = (current: string | null = null): CaseFieldItem => ({ mondayItemId: "item-1", current });

describe("planCaseFieldWrite", () => {
  it("moves a Fee K to another PS Stage (label matched case-insensitively)", () => {
    const r = planCaseFieldWrite("fee_k", { field: "ps_stage", value: "evidence received", from: "Need Evidence" }, item("Need Evidence"), FEE_SCHEMA, TODAY);
    expect(r).toMatchObject({ plan: { mondayItemId: "item-1", mondayBoardId: "4880153390", from: "Need Evidence", to: "Evidence Received", def: { columnId: "status6__1" } } });
  });

  it("refuses a status Monday doesn't have, with the allowed labels", () => {
    const r = planCaseFieldWrite("fee_k", { field: "ps_stage", value: "Done", from: null }, item(), FEE_SCHEMA, TODAY);
    expect(r).toMatchObject({ rejection: { status: 400, allowed: ["Need Evidence", "Evidence Received"] } });
  });

  it("refuses an empty status", () => {
    expect(planCaseFieldWrite("open_form", { field: "status", value: "" }, item("Needs Forms Appt"), FORM_SCHEMA, TODAY))
      .toMatchObject({ rejection: { status: 400 } });
  });

  it("refuses fields outside the allowlist, and fields of the other board", () => {
    expect(planCaseFieldWrite("fee_k", { field: "af", value: "1" }, item(), FEE_SCHEMA, TODAY)).toMatchObject({ rejection: { status: 400 } });
    expect(planCaseFieldWrite("open_form", { field: "ps_stage", value: "Need Evidence" }, item(), FORM_SCHEMA, TODAY)).toMatchObject({ rejection: { status: 400 } });
  });

  it("sets and clears dates", () => {
    expect(planCaseFieldWrite("open_form", { field: "forms_appt_date", value: "2026-11-02", from: null }, item(), FORM_SCHEMA, TODAY))
      .toMatchObject({ plan: { to: "2026-11-02", def: { columnId: "date_mkkwqnd4" } } });
    expect(planCaseFieldWrite("open_form", { field: "forms_appt_date", value: "", from: "2026-11-02" }, item("2026-11-02"), FORM_SCHEMA, TODAY))
      .toMatchObject({ plan: { to: null } });
  });

  it("refuses bad dates and a future reminder / evidence date", () => {
    for (const value of ["2026-02-30", "10/14/2026", "soon"]) {
      expect(planCaseFieldWrite("fee_k", { field: "reminder_sent_checked_on", value }, item(), FEE_SCHEMA, TODAY)).toMatchObject({ rejection: { status: 400 } });
    }
    expect(planCaseFieldWrite("fee_k", { field: "evidence_received_date", value: "2026-10-15" }, item(), FEE_SCHEMA, TODAY))
      .toMatchObject({ rejection: { status: 400, error: "Evidence received can't be in the future" } });
    expect(planCaseFieldWrite("fee_k", { field: "evidence_received_date", value: TODAY }, item(), FEE_SCHEMA, TODAY)).toHaveProperty("plan");
  });

  it("refuses when the value changed on Monday since the card opened", () => {
    const r = planCaseFieldWrite("fee_k", { field: "ps_stage", value: "Evidence Received", from: "Need Evidence" }, item("Para Assigned"), FEE_SCHEMA, TODAY);
    expect(r).toMatchObject({ rejection: { status: 409, current: "Para Assigned" } });
  });

  it("refuses when nothing changed", () => {
    expect(planCaseFieldWrite("fee_k", { field: "ps_stage", value: "Need Evidence" }, item("Need Evidence"), FEE_SCHEMA, TODAY))
      .toMatchObject({ rejection: { status: 400, error: "Nothing changed" } });
  });

  it("refuses an item that hasn't synced to Monday, and a missing column", () => {
    expect(planCaseFieldWrite("fee_k", { field: "ps_stage", value: "Need Evidence" }, { mondayItemId: null, current: null }, FEE_SCHEMA, TODAY))
      .toMatchObject({ rejection: { status: 400 } });
    expect(planCaseFieldWrite("open_form", { field: "target_date", value: "2026-11-02" }, item(), FORM_SCHEMA, TODAY))
      .toMatchObject({ rejection: { status: 409 } });
    expect(planCaseFieldWrite("fee_k", { field: "ps_stage", value: "Need Evidence" }, null, FEE_SCHEMA, TODAY))
      .toMatchObject({ rejection: { status: 404 } });
  });
});

describe("planEFileWrite", () => {
  const LINK = "https://firm.sharepoint.com/:f:/s/scalefiles/abc";

  it("sets a link where the profile has none", () => {
    expect(planEFileWrite({ url: ` ${LINK} ` }, null)).toEqual({ plan: { url: LINK, previous: null } });
  });

  it("only takes https SharePoint links", () => {
    for (const url of ["", "http://firm.sharepoint.com/x", "https://drive.google.com/x", "not a link"]) {
      expect(planEFileWrite({ url }, null)).toMatchObject({ rejection: { status: 400 } });
    }
  });

  it("never overwrites a link set in Monday, unless it is the one being replaced", () => {
    const other = "https://firm.sharepoint.com/:f:/s/scalefiles/other";
    expect(planEFileWrite({ url: LINK }, other)).toMatchObject({ rejection: { status: 409, current: other } });
    expect(planEFileWrite({ url: LINK, replaces: `${other}/` }, other)).toEqual({ plan: { url: LINK, previous: other } });
    expect(planEFileWrite({ url: LINK }, LINK.replace("https://", ""))).toMatchObject({ rejection: { status: 400 } });
  });
});
