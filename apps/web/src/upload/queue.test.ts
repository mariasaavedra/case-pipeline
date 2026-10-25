import { describe, it, expect } from "vitest";
import { MAX_FILE_BYTES, allSettled, errorFor, precheck, toStart, uploadUrl, type QueueItem } from "./queue";
import { STRINGS } from "./strings";
import { tokenFromPath } from "./UploadPage";

const item = (id: number, state: QueueItem["state"]): QueueItem =>
  ({ id, file: { name: `f${id}.pdf`, size: 10 } as File, kind: "notice", note: "", state });

describe("toStart", () => {
  it("two at a time, oldest first", () => {
    const q = [item(1, { s: "waiting" }), item(2, { s: "waiting" }), item(3, { s: "waiting" })];
    expect(toStart(q).map((i) => i.id)).toEqual([1, 2]);
    const busy = [item(1, { s: "sending", pct: 40 }), item(2, { s: "done", duplicate: false }), item(3, { s: "waiting" }), item(4, { s: "waiting" })];
    expect(toStart(busy).map((i) => i.id)).toEqual([3]);
    expect(toStart([item(1, { s: "sending", pct: 1 }), item(2, { s: "sending", pct: 1 }), item(3, { s: "waiting" })])).toEqual([]);
  });
});

describe("precheck", () => {
  it("empty and over 50 MB fail before sending", () => {
    expect(precheck({ size: 0 })).toBe("other");
    expect(precheck({ size: MAX_FILE_BYTES + 1 })).toBe("tooBig");
    expect(precheck({ size: MAX_FILE_BYTES })).toBeNull();
  });
});

describe("errorFor", () => {
  it("maps the API's answers; retry only where it can help", () => {
    expect(errorFor(0)).toEqual({ error: "network", retry: true });
    expect(errorFor(404)).toEqual({ error: "dead", retry: false });
    expect(errorFor(413)).toEqual({ error: "tooBig", retry: false });
    expect(errorFor(413, "link_full")).toEqual({ error: "linkFull", retry: false });
    expect(errorFor(415, "type")).toEqual({ error: "type", retry: false });
    expect(errorFor(429)).toEqual({ error: "tooMany", retry: true });
    expect(errorFor(400, "item")).toEqual({ error: "itemGone", retry: false });
    expect(errorFor(502)).toEqual({ error: "other", retry: true });
  });
  it("every error has words in both languages", () => {
    for (const status of [0, 404, 413, 415, 429, 500]) {
      const { error } = errorFor(status);
      expect(STRINGS.es.errors[error]).toBeTruthy();
      expect(STRINGS.en.errors[error]).toBeTruthy();
    }
  });
});

describe("allSettled", () => {
  it("true once nothing is waiting or sending", () => {
    expect(allSettled([])).toBe(false);
    expect(allSettled([item(1, { s: "done", duplicate: false }), item(2, { s: "error", error: "type", retry: false })])).toBe(true);
    expect(allSettled([item(1, { s: "done", duplicate: false }), item(2, { s: "sending", pct: 3 })])).toBe(false);
  });
});

describe("uploadUrl", () => {
  it("name + kind, the note only when there is one", () => {
    const token = "a".repeat(43);
    expect(uploadUrl(token, { file: { name: "aviso 1.pdf" } as File, kind: "notice", note: "  " }))
      .toBe(`/api/u/${token}/files?name=aviso+1.pdf&kind=notice`);
    expect(uploadUrl(token, { file: { name: "" } as File, kind: "id", note: "llegó hoy" }))
      .toBe(`/api/u/${token}/files?name=photo.jpg&kind=id&note=lleg%C3%B3+hoy`);
  });

  it("a checklist document adds its item id", () => {
    const token = "a".repeat(43);
    expect(uploadUrl(token, { file: { name: "p.jpg" } as File, kind: "evidence", note: "", itemId: 12 }))
      .toBe(`/api/u/${token}/files?name=p.jpg&kind=evidence&item=12`);
  });
});

describe("tokenFromPath", () => {
  it("only /u/<43-character token>", () => {
    const token = "xg9vEvhcO696c26xvwAIVgNP819mjTtIAJgXZCDMPqU";
    expect(tokenFromPath(`/u/${token}`)).toBe(token);
    expect(tokenFromPath(`/u/${token}/`)).toBe(token);
    expect(tokenFromPath("/u/short")).toBeNull();
    expect(tokenFromPath(`/clients/${token}`)).toBeNull();
  });
});
