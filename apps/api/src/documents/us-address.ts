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
// Checked against every address in live.db (2026-10-22): no comma before the
// city ("… Ave Topeka KS"), a suffix glued to the city ("AveKansas City"), a
// unit or rural-route number before the city ("Ave., #3 Kansas City"), "kcmo",
// a "null" left by a form, and a missing state the zip gives away.
// =============================================================================

export type UnitType = "" | "apt" | "ste" | "flr";

export interface SplitAddress {
  /** Everything before the city, unit included, as typed ("1234 Main St Apt 5"). */
  line1: string;
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

/**
 * Cities our clients live in, for an address with no comma before the city and
 * no street suffix to cut at ("1018 SW Jewell Topeka, KS"). The most common
 * ones in live.db; multi-word ones matter most ("Overland Park", "St Joseph").
 */
const KNOWN_CITIES = [
  "kansas city", "north kansas city", "overland park", "olathe", "topeka", "wichita", "springfield", "independence",
  "grandview", "lenexa", "shawnee", "lawrence", "manhattan", "leavenworth", "garden city", "cottonwood falls",
  "lees summit", "lee's summit", "lee’s summit", "blue springs", "columbia", "carthage", "liberty", "de soto", "emporia",
  "belton", "roeland park", "salina", "branson", "hutchinson", "dodge city", "st joseph", "st. joseph", "saint joseph",
  "raytown", "raymore", "gardner", "mission", "mcpherson", "sedalia", "newton", "merriam", "great bend", "riverside",
  "edwardsville", "bonner springs", "rolla", "jefferson city", "joplin", "liberal", "pittsburg", "st louis", "st. louis",
  "saint louis", "scott city", "cape girardeau", "oklahoma city", "leawood", "gladstone", "excelsior springs",
  "prairie village", "grain valley", "pleasant hill", "oak grove", "sugar creek", "arkansas city", "lake ozark",
  "harrisonville", "kearney", "eudora", "colby", "west plains", "blue mound", "lakin", "st charles", "saint charles",
  "saint peters", "st peters", "westwood hills", "westwood", "fairway", "mission hills", "basehor", "tonganoxie",
  "spring hill", "peculiar", "smithville", "parkville", "platte city", "lansing", "junction city", "ulysses", "holcomb",
].sort((a, b) => b.length - a.length);

/** Shorthand typed for a city: "kcmo" → Kansas City, MO. */
const CITY_ALIASES: Record<string, { city: string; state?: string }> = {
  kcmo: { city: "Kansas City", state: "MO" }, kck: { city: "Kansas City", state: "KS" }, kcks: { city: "Kansas City", state: "KS" },
  kc: { city: "Kansas City" }, op: { city: "Overland Park", state: "KS" },
};

/** The state a zip belongs to, for the states our clients live in (first three digits). */
const ZIP3_STATES: [number, number, string][] = [
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [500, 528, "IA"], [716, 729, "AR"], [730, 731, "OK"],
  [734, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [600, 629, "IL"],
];
const stateOfZip = (zip: string) => {
  const z = Number(zip.slice(0, 3));
  return ZIP3_STATES.find(([lo, hi]) => z >= lo && z <= hi)?.[2] ?? "";
};

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|ter|terr|terrace|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|trl|trail|sq|square)\b\.?/gi;

const UNIT = /[\s,]*(?:\b(apt|apartment|unit|ste|suite|fl|flr|floor|lot|rm|room)\b\.?|#)\s*#?\s*([A-Za-z0-9-]+)/i;

function unitTypeOf(word: string | undefined): UnitType {
  const w = (word ?? "").toLowerCase();
  if (w === "ste" || w === "suite") return "ste";
  if (w === "fl" || w === "flr" || w === "floor") return "flr";
  return "apt";
}

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,.-]+$/g, "").trim();

export function splitUsAddress(line: string | null | undefined): SplitAddress {
  const out: SplitAddress = { line1: "", street: "", unitType: "", unit: "", city: "", state: "", zip: "" };
  // ";" as a comma; "Kansas - 66215".
  let rest = tidy((line ?? "").replace(/\n|;/g, ", ").replace(/\s+-\s+(?=\d{5}\b)/g, " "));
  if (!rest) return out;

  // A "null" a form left behind; a suffix or number glued to the city
  // ("Oakland AveKansas City", "12 00Kansas City").
  rest = tidy(rest.replace(/(^|[\s,])null(?=[\s,]|$)/gi, "$1")
    .replace(/\b(St|Ave|Dr|Rd|Ln|Ct|Blvd|Ter|Pl|Cir|Pkwy|Hwy)(?=[A-Z][a-z])/g, "$1 ")
    .replace(/(\d)(?=[A-Z][a-z]{2})/g, "$1 "));
  // The same "City, ST zip" typed twice.
  rest = tidy(rest.replace(/^(.*?)[\s,]+(.{8,})[\s,]+\2$/i, "$1, $2"));

  // Trailing country.
  rest = tidy(rest.replace(/,?\s*(usa|u\.s\.a\.?|united states( of america)?)$/i, ""));

  // Zip (also when typed before the state: "Lawrence 66046 KS").
  const takeZip = () => {
    // Glued to the state counts too ("KS66104", "MO-64111", "kansas66101").
    const zip = /(?<!\d)(\d{5})(?:-\d{4})?$/.exec(rest);
    if (!zip || out.zip) return;
    out.zip = zip[1]!;
    rest = tidy(rest.slice(0, zip.index));
  };
  takeZip();

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
  takeZip();

  // City: after the last comma; with no comma, a city we know at the end, else
  // after the last street suffix (or unit) — only when a state or zip was
  // found, so "1234 Main St" alone doesn't lose a word to the city.
  if (out.state || out.zip) {
    const comma = rest.lastIndexOf(",");
    const lower = rest.toLowerCase();
    const known = KNOWN_CITIES.find((c) => lower.endsWith(` ${c}`));
    if (comma > 0) {
      out.city = tidy(rest.slice(comma + 1));
      rest = tidy(rest.slice(0, comma));
    } else if (known) {
      out.city = tidy(rest.slice(rest.length - known.length));
      rest = tidy(rest.slice(0, rest.length - known.length));
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
    // A city never starts with a number, a "#" or a lone direction: those are the
    // end of the street ("Ave., #3 Kansas City", "Rd V5 Lakin", "Terrace N Independence").
    const lead = /^((?:(?:#?[A-Za-z]{0,3}\d[\d-]*[A-Za-z]?|#\S*|[NSEW])[\s,]+)+)(?=[A-Za-z])/i.exec(out.city);
    if (lead && /\d/.test(rest)) {
      // A zip typed before the city too ("Apt B 64701 Harrisonville, MO 64701") is dropped.
      const moved = lead[1]!.replace(/,/g, " ").split(/\s+/).filter((t) => t && t !== out.zip).join(" ");
      rest = tidy(`${rest} ${moved}`);
      out.city = tidy(out.city.slice(lead[0].length));
    }
    const alias = CITY_ALIASES[out.city.toLowerCase()];
    if (alias) {
      out.city = alias.city;
      out.state ||= alias.state ?? "";
    }
    if (!out.state && out.zip) out.state = stateOfZip(out.zip);
  }

  out.line1 = rest;

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

/**
 * A one-line address as a letter prints it: the street line, and
 * "City, ST zip". When no city is found the whole line stays on the street
 * and cityStateZip is "" — staff fill it in.
 */
export function letterAddress(line: string | null | undefined): { street: string; cityStateZip: string } {
  const full = tidy(line ?? "");
  const a = splitUsAddress(full);
  if (!a.city || (!a.state && !a.zip)) return { street: lowerToTitle(full), cityStateZip: "" };
  return { street: lowerToTitle(a.line1), cityStateZip: `${lowerToTitle(a.city)}, ${[a.state, a.zip].filter(Boolean).join(" ")}` };
}

/** The address on one line, tidied: "Street, City, ST zip" (as typed when it can't be split). */
export function oneLineAddress(line: string | null | undefined): string {
  const l = letterAddress(line);
  return [l.street, l.cityStateZip].filter(Boolean).join(", ");
}

/**
 * Typed all in lowercase ("2418 n 12 st kansas city") → "2418 N 12 St Kansas
 * City" for a letter. Anything with a capital letter is left as typed.
 */
function lowerToTitle(s: string): string {
  if (/[A-Z]/.test(s)) return s;
  return s.replace(/[^\s,]+/g, (w) =>
    /^(n|s|e|w|ne|nw|se|sw|po)$/.test(w) ? w.toUpperCase() : /^\d/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1));
}
