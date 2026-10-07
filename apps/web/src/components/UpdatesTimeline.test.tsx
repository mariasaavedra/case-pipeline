// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientUpdate } from "../api";
import { UpdatesTimeline, threadEntries, collapseCopies } from "./UpdatesTimeline";

function entry(o: Partial<ClientUpdate> & { localId: string }): ClientUpdate {
  return {
    profileLocalId: "p1",
    boardItemLocalId: null,
    boardKey: null,
    authorName: "Ana Ruiz",
    authorEmail: null,
    title: null,
    textBody: "body",
    bodyHtml: null,
    sourceType: "update",
    activityTypeName: null,
    replyToUpdateId: null,
    createdAtSource: "2026-09-01T15:00:00Z",
    attachments: [],
    mondayItemId: null,
    mondayBoardId: null,
    parentLocalId: null,
    canReply: false,
    emailParticipants: null,
    ...o,
  };
}

describe("threadEntries", () => {
  it("nests replies under a parent that is present, oldest first", () => {
    const { roots, replies } = threadEntries([
      entry({ localId: "r2", parentLocalId: "u1", createdAtSource: "2026-09-03T00:00:00Z" }),
      entry({ localId: "r1", parentLocalId: "u1", createdAtSource: "2026-09-02T00:00:00Z" }),
      entry({ localId: "u1" }),
    ]);
    expect(roots.map((r) => r.localId)).toEqual(["u1"]);
    expect(replies.get("u1")!.map((r) => r.localId)).toEqual(["r1", "r2"]);
  });

  // The parent can be filtered out (an email under "Notes") or older than the loaded page.
  it("keeps a reply whose parent is missing in the main stream", () => {
    const { roots } = threadEntries([entry({ localId: "r1", parentLocalId: "gone" })]);
    expect(roots.map((r) => r.localId)).toEqual(["r1"]);
  });
});

describe("UpdatesTimeline", () => {
  const html = (updates: ClientUpdate[], withReplies = false) =>
    renderToStaticMarkup(
      <UpdatesTimeline updates={updates} onReplyPosted={withReplies ? () => {} : undefined} />,
    );

  it("links a profile entry to the Profiles board and a board entry to its own board", () => {
    const out = html([
      entry({ localId: "u1", mondayItemId: "111" }),
      entry({ localId: "a1", sourceType: "custom", mondayItemId: "222", mondayBoardId: "999" }),
    ]);
    expect(out).toContain("https://scaltheclinic.monday.com/boards/8025265377/pulses/111");
    expect(out).toContain("https://scaltheclinic.monday.com/boards/999/pulses/222");
  });

  it("points emails at Monday for their attachments", () => {
    expect(html([entry({ localId: "e1", sourceType: "email", mondayItemId: "111" })])).toContain(
      "Open in Monday for attachments",
    );
  });

  it("offers Reply only where sub-notes are enabled and the entry has reached Monday", () => {
    expect(html([entry({ localId: "u1", canReply: true })], true)).toContain("Reply");
    expect(html([entry({ localId: "u1", canReply: true })], false)).not.toContain("Reply");
    expect(html([entry({ localId: "u1", canReply: false })], true)).not.toContain("Reply");
  });

  it("shows an email's sender and recipients, collapsing a long list", () => {
    const out = html([
      entry({
        localId: "e1",
        sourceType: "email",
        emailParticipants: { from: "client@gmail.com", to: ["a@firm.com", "b@firm.com", "c@firm.com"], cc: ["d@firm.com"], bcc: [] },
      }),
    ]);
    expect(out).toContain("client@gmail.com");
    expect(out).toContain("a@firm.com, b@firm.com");
    expect(out).toContain("+1 more");
    expect(out).toContain("d@firm.com");
    expect(out).not.toContain("Bcc");
  });

  it("renders a note's formatting instead of flattened text", () => {
    const out = html([entry({ localId: "u1", textBody: "One Two", bodyHtml: "<ul><li>One</li><li>Two</li></ul>" })]);
    expect(out).toContain("<ul><li>One</li><li>Two</li></ul>");
  });
});

describe("collapseCopies", () => {
  const prep = "Type of appt: 1st time How to proceed: Zoom — https://zoom.us/j/1 Interpreter: Not needed Client wrote: I want to petition for my wife";
  // E&A's own rendering: "url [url]", and cut short.
  const prepEA = "Type of appt: 1st time How to proceed: Zoom — https://zoom.us/j/1 [https://zoom.us/j/1] Interpreter: Not needed";
  const collapse = (list: ClientUpdate[]) => {
    const t = threadEntries(list);
    return collapseCopies(t.roots, t.replies);
  };

  it("shows a consult prep once — the profile Update — with where else it was posted", () => {
    const r = collapse([
      entry({ localId: "ea", sourceType: "custom", textBody: prepEA, createdAtSource: "2026-10-06T22:33:29Z" }),
      entry({ localId: "appt", boardKey: "appointments_m", textBody: prep, createdAtSource: "2026-10-06T22:33:28Z" }),
      entry({ localId: "prof", textBody: prep, createdAtSource: "2026-10-06T22:33:27Z" }),
    ]);
    expect(r.roots.map((u) => u.localId)).toEqual(["prof"]);
    expect(r.alsoOn.get("prof")).toEqual(["Emails & Activities", "Appointments (M)"]);
  });

  it("keeps notes that only look alike: short, far apart in time, or email vs note", () => {
    const r = collapse([
      entry({ localId: "a", textBody: "Called, no answer", createdAtSource: "2026-10-06T10:00:00Z" }),
      entry({ localId: "b", textBody: "Called, no answer", createdAtSource: "2026-10-06T10:01:00Z" }),
      entry({ localId: "c", textBody: prep, createdAtSource: "2026-10-06T10:00:00Z" }),
      entry({ localId: "d", textBody: prep, createdAtSource: "2026-10-06T11:00:00Z" }),
      entry({ localId: "e", sourceType: "email", textBody: prep, createdAtSource: "2026-10-06T11:00:30Z" }),
    ]);
    expect(r.roots.map((u) => u.localId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.alsoOn.size).toBe(0);
  });

  it("moves replies from a dropped copy onto the one shown", () => {
    const r = collapse([
      entry({ localId: "prof", textBody: prep }),
      entry({ localId: "ea", sourceType: "custom", textBody: prepEA }),
      entry({ localId: "re", sourceType: "reply", parentLocalId: "ea", textBody: "ok", createdAtSource: "2026-09-02T00:00:00Z" }),
    ]);
    expect(r.roots.map((u) => u.localId)).toEqual(["prof"]);
    expect(r.replies.get("prof")!.map((u) => u.localId)).toEqual(["re"]);
  });
});
