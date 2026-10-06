// =============================================================================
// Split a one-line US address into the boxes a USCIS form wants
// =============================================================================
// Monday keeps a client's address as one free-text line, typed many ways:
//   "1234 Main St Apt 5, Kansas City, MO 64105"
//   "1234 Main St, Kansas City MO 64105"
//   "1234 Main St Kansas City Missouri 64105"
//   "1234 Main St"
// This is best effort: what can't be placed stays on the street line, and the
// G-28 popup shows every box for staff to correct before generating.
// =============================================================================

export type UnitType = "" | "apt" | "ste" | "flr";

export interface SplitAddress {
  street: string;
  unitType: UnitType;
  unit: string;
  city: string;
  state: string;
  zip: string;
}

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const ABBREVS = new Set(Object.values(STATES));

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|ter|terr|terrace|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|trl|trail|sq|square)\b\.?/gi;

const UNIT = /[\s,]*(?:\b(apt|apartment|unit|ste|suite|fl|flr|floor|lot|rm|room)\b\.?|#)\s*#?\s*([A-Za-z0-9-]+)/i;

function unitTypeOf(word: string | undefined): UnitType {
  const w = (word ?? "").toLowerCase();
  if (w === "ste" || w === "suite") return "ste";
  if (w === "fl" || w === "flr" || w === "floor") return "flr";
  return "apt";
}

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,.]+$/g, "").trim();

export function splitUsAddress(line: string | null | undefined): SplitAddress {
  const out: SplitAddress = { street: "", unitType: "", unit: "", city: "", state: "", zip: "" };
  let rest = tidy((line ?? "").replace(/\n/g, ", "));
  if (!rest) return out;

  // Trailing country.
  rest = tidy(rest.replace(/,?\s*(usa|u\.s\.a\.?|united states( of america)?)$/i, ""));

  // Zip.
  const zip = /\s*(\d{5})(?:-\d{4})?$/.exec(rest);
  if (zip) {
    out.zip = zip[1]!;
    rest = tidy(rest.slice(0, zip.index));
  }

  // State: a two-letter code or a full name at the end.
  const code = /[\s,]+([A-Za-z]{2})$/.exec(rest);
  if (code && ABBREVS.has(code[1]!.toUpperCase())) {
    out.state = code[1]!.toUpperCase();
    rest = tidy(rest.slice(0, code.index));
  } else {
    const lower = rest.toLowerCase();
    const name = Object.keys(STATES)
      .sort((a, b) => b.length - a.length)
      .find((n) => lower.endsWith(` ${n}`) || lower.endsWith(`,${n}`));
    if (name) {
      out.state = STATES[name]!;
      rest = tidy(rest.slice(0, rest.length - name.length));
    }
  }

  // City: after the last comma; with no comma, after the last street suffix
  // (or unit) — only when a state or zip was found, so "1234 Main St" alone
  // doesn't lose a word to the city.
  if (out.state || out.zip) {
    const comma = rest.lastIndexOf(",");
    if (comma > 0) {
      out.city = tidy(rest.slice(comma + 1));
      rest = tidy(rest.slice(0, comma));
    } else {
      let cut = -1;
      for (const m of rest.matchAll(STREET_SUFFIX)) cut = m.index! + m[0].length;
      const unit = new RegExp(UNIT.source + "\\s", "gi");
      for (const m of rest.matchAll(unit)) cut = Math.max(cut, m.index! + m[0].length - 1);
      if (cut > 0 && cut < rest.length) {
        out.city = tidy(rest.slice(cut));
        rest = tidy(rest.slice(0, cut));
      }
    }
  }

  // Unit.
  const unit = UNIT.exec(rest);
  if (unit && unit.index > 0) {
    out.unitType = unitTypeOf(unit[1]);
    out.unit = unit[2]!;
    rest = tidy(rest.slice(0, unit.index) + rest.slice(unit.index + unit[0].length));
  }

  out.street = rest;
  return out;
}
