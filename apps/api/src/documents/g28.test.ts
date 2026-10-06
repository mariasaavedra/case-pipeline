import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { REPO_ROOT } from "../paths.js";
import { DEFAULT_DOCUMENT_SETTINGS } from "./document-settings.js";
import {
  fillG28, formANumber, formPhone, g28FileName, g28Prefill, g28Problems, matchAttorney,
  type G28ProfileRow,
} from "./g28.js";

const profile = (over: Partial<G28ProfileRow> = {}): G28ProfileRow => ({
  name: "Maria Lopez", firstName: "Maria", lastName: "Lopez", middleName: null,
  aNumber: "A-241-045-572", phone: "(816) 555-0101", email: "maria@example.com",
  mailingAddress: "1234 Main St Apt 5, Kansas City, MO 64105", physicalAddress: null,
  city: null, state: null, zip: null, attorney: "Lucy Betteridge", ...over,
});

describe("small formatters", () => {
  it("formats phones and A-Numbers the way the form takes them", () => {
    expect(formPhone("+1 (816) 994-2300")).toBe("8169942300");
    expect(formANumber("A-241-045-572")).toBe("241045572");
    expect(formANumber("41045572")).toBe("041045572");
  });

  it("names the file after the client and the date", () => {
    const { input } = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, null);
    expect(g28FileName(input, "2026-10-06")).toBe("G-28 – LOPEZ Maria – 2026-10-06.pdf");
  });
});

describe("matchAttorney", () => {
  const list = DEFAULT_DOCUMENT_SETTINGS.attorneys;
  it("matches Monday's full name and the e-mail-like Rekha label", () => {
    expect(matchAttorney(list, "Lucy Betteridge")?.id).toBe("lucy");
    expect(matchAttorney(list, "Rekha@Sharma- com, Michael Sharma-Crawford")?.id).toBe("rekha");
    expect(matchAttorney(list, "William Hanna")).toBeNull();
  });
});

describe("g28Prefill", () => {
  it("fills a free client from the profile, USCIS + Applicant", () => {
    const p = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, null);
    expect(p.input.attorney).toMatchObject({ id: "lucy", barNumber: "62586", licensingAuthority: "MO", email: "lucy@sharma-crawford.com", fax: "8169942310" });
    expect(p.input.client).toMatchObject({ familyName: "LOPEZ", givenName: "Maria", aNumber: "241045572", phone: "8165550101", email: "maria@example.com" });
    expect(p.input.client.address).toMatchObject({ street: "1234 Main St", unitType: "apt", unit: "5", city: "Kansas City", state: "MO", zip: "64105" });
    expect(p.input.matter).toMatchObject({ agency: "uscis", clientRole: "applicant" });
    expect(p.facilityMissing).toBe(false);
  });

  it("uses Michael's MO bar by default", () => {
    const p = g28Prefill(profile({ attorney: "Michael Sharma-Crawford" }), DEFAULT_DOCUMENT_SETTINGS, null);
    expect(p.input.attorney).toMatchObject({ licensingAuthority: "MO", barNumber: "57287" });
  });

  it("puts a detained client at the facility, ICE + Respondent, without the family's phone", () => {
    const p = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, "Core Civic");
    expect(p.input.client.address).toMatchObject({ street: "IN ICE CUSTODY 831 Sabalu Rd", city: "Leavenworth", state: "KS", zip: "66027" });
    expect(p.input.matter).toMatchObject({ agency: "ice", specificMatter: "Consult only", clientRole: "respondent" });
    expect(p.input.client.phone).toBe("");
    expect(p.profileContact.phone).toBe("8165550101");
  });

  it("flags a facility with no address in Settings and keeps the profile address", () => {
    const p = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, "Other");
    expect(p.facilityMissing).toBe(true);
    expect(p.input.client.address.street).toBe("1234 Main St");
  });

  it("fills address gaps from the City / State / Zip columns and strips name notes", () => {
    const p = g28Prefill(
      profile({ mailingAddress: "", physicalAddress: "88 Pine Rd", city: "Olathe", state: "KS", zip: "66061", lastName: "Ventura [A221-455-213] (Det In Core Civic)" }),
      DEFAULT_DOCUMENT_SETTINGS, null,
    );
    expect(p.input.client.address).toMatchObject({ street: "88 Pine Rd", city: "Olathe", state: "KS", zip: "66061" });
    expect(p.input.client.familyName).toBe("VENTURA");
  });

  it("falls back to the item name when the name columns are empty", () => {
    const p = g28Prefill(profile({ firstName: null, lastName: null, name: "Juan Carlos Perez" }), DEFAULT_DOCUMENT_SETTINGS, null);
    expect(p.input.client).toMatchObject({ familyName: "PEREZ", givenName: "Juan Carlos" });
  });
});

describe("g28Problems", () => {
  it("passes a complete prefill and catches the gaps", () => {
    const { input } = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, "Core Civic");
    expect(g28Problems(input)).toEqual([]);
    expect(g28Problems({ ...input, matter: { ...input.matter, specificMatter: " " } })).toContain("Describe the ICE matter.");
    expect(g28Problems({ ...input, client: { ...input.client, aNumber: "123" } })).toContain("A-Number must be 9 digits.");
    const long = { ...input, client: { ...input.client, address: { ...input.client.address, street: "x".repeat(40) } } };
    expect(g28Problems(long)).toContain("Client Street: 40 characters, the form fits 34.");
  });
});

describe("fillG28", () => {
  const template = new Uint8Array(fs.readFileSync(path.join(REPO_ROOT, "templates/forms/g-28.pdf")));

  it("fills the official form and leaves signatures empty", async () => {
    const { input } = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, "Core Civic");
    const out = await PDFDocument.load(await fillG28(template, input));
    const f = out.getForm();
    const t = (n: string) => f.getTextField(n).getText();
    const c = (n: string) => f.getCheckBox(n).isChecked();

    expect(t("form1[0].#subform[0].Pt1Line2a_FamilyName[0]")).toBe("Betteridge");
    // Field names swapped by USCIS: Line7_Mobile… is the Email box.
    expect(t("form1[0].#subform[0].Line7_MobileTelephoneNumber[0]")).toBe("lucy@sharma-crawford.com");
    expect(t("form1[0].#subform[0].Line6_EMail[0]")).toBe("N/A");
    expect(t("form1[0].#subform[0].Pt2Line1b_BarNumber[0]")).toBe("62586");
    expect(t("form1[0].#subform[0].Pt2Line1d_NameofFirmOrOrganization[0]")).toBe("Sharma-Crawford Attorneys at Law");
    expect(f.getDropdown("form1[0].#subform[0].Line3d_State[0]").getSelected()).toEqual(["MO"]);
    expect(c("form1[0].#subform[0].CheckBox1[0]")).toBe(true);
    expect(c("form1[0].#subform[0].Checkbox1dAmNot[0]")).toBe(true);

    expect(c("form1[0].#subform[1].Line2a_ICE[0]")).toBe(true);
    expect(c("form1[0].#subform[1].Line1a_USCIS[0]")).toBe(false);
    expect(t("form1[0].#subform[1].Line2b_ListMatter[0]")).toBe("Consult only");
    expect(t("form1[0].#subform[1].Line1b_ListFormNumber[0]")).toBe("N/A");
    expect(c("form1[0].#subform[1].Line4_Checkbox[2]")).toBe(true); // Respondent
    expect(c("form1[0].#subform[1].Line4_Checkbox[1]")).toBe(false); // Applicant

    expect(t("form1[0].#subform[1].Pt3Line5a_FamilyName[0]")).toBe("LOPEZ");
    expect(t("form1[0].#subform[1].Pt3Line9_ANumber[0]")).toBe("241045572");
    expect(t("form1[0].#subform[1].Line12a_StreetNumberName[0]")).toBe("IN ICE CUSTODY 831 Sabalu Rd");
    expect(f.getDropdown("form1[0].#subform[1].Line12d_State[0]").getSelected()).toEqual(["KS"]);
    expect(t("form1[0].#subform[1].Line9_DaytimeTelephoneNumber[0]")).toBe("N/A");

    expect(c("form1[0].#subform[2].Pt4Line2a_CheckBox2a[0]")).toBe(true);
    expect(c("form1[0].#subform[2].Pt4Line2c_CheckBox2c[0]")).toBe(false);
    expect(t("form1[0].#subform[2].Line1_Signature[0]") ?? "").toBe("");
    expect(t("form1[0].#subform[2].Line3_Date[0]") ?? "").toBe("");

    expect(t("form1[0].#subform[3].Pt3Line5a_FamilyName[1]")).toBe("LOPEZ");
  });

  it("checks the apartment box for an apartment", async () => {
    const { input } = g28Prefill(profile(), DEFAULT_DOCUMENT_SETTINGS, null);
    const f = (await PDFDocument.load(await fillG28(template, input))).getForm();
    expect(f.getCheckBox("form1[0].#subform[1].Line12b_Unit[2]").isChecked()).toBe(true);
    expect(f.getCheckBox("form1[0].#subform[1].Line12b_Unit[0]").isChecked()).toBe(false);
    expect(f.getTextField("form1[0].#subform[1].Line12b_AptSteFlrNumber[0]").getText()).toBe("5");
  });
});
