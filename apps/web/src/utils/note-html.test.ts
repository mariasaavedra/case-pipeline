// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderNoteHtml } from "./note-html";

describe("renderNoteHtml — sanitizing", () => {
  // Email bodies are written by whoever sent the email; none of it may run.
  it("strips scripts, event handlers and javascript: links", () => {
    const { main } = renderNoteHtml(
      `<p onclick="alert(1)">Hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a><img src=x onerror="alert(4)">`,
    );
    expect(main).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(main).toContain("Hi");
  });

  it("drops the sender's fonts and colors but keeps structure", () => {
    const { main } = renderNoteHtml(`<ul><li style="color:red"><font color="red" face="Arial">One</font></li></ul>`);
    expect(main).toContain("<ul><li>");
    expect(main).not.toMatch(/style=|color=|face=/);
  });

  it("opens links in a new tab without an opener", () => {
    const { main } = renderNoteHtml(`<a href="https://example.com">site</a>`);
    expect(main).toContain('target="_blank"');
    expect(main).toContain('rel="noopener noreferrer"');
  });

  it("removes embedded <style> blocks", () => {
    expect(renderNoteHtml(`<style>body{display:none}</style><p>ok</p>`).main).toBe("<p>ok</p>");
  });
});

describe("renderNoteHtml — quoted history", () => {
  it("leaves quotes in place unless asked to split", () => {
    const r = renderNoteHtml(`<p>New</p><div class="gmail_quote">Old</div>`);
    expect(r.quoted).toBeNull();
    expect(r.main).toContain("Old");
  });

  it("splits a Gmail quote off the new message", () => {
    const r = renderNoteHtml(`<div>Thanks!</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:</div><blockquote>Old</blockquote></div>`, { splitQuoted: true });
    expect(r.main).toBe("<div>Thanks!</div>");
    expect(r.quoted).toContain("Old");
  });

  it("splits an Outlook reply at its divRplyFwdMsg header, taking everything after it", () => {
    const r = renderNoteHtml(
      `<div><p>See attached.</p><hr><div id="divRplyFwdMsg"><b>From:</b> Ana</div><div>Older text</div></div>`,
      { splitQuoted: true },
    );
    expect(r.main).toContain("See attached.");
    expect(r.main).not.toContain("Older text");
    expect(r.quoted).toContain("Older text");
  });

  it("splits at a plain From:/Sent: header block", () => {
    const r = renderNoteHtml(`<p>Reply here</p><p><b>From:</b> Ana <b>Sent:</b> Monday</p><p>Old body</p>`, { splitQuoted: true });
    expect(r.main).toBe("<p>Reply here</p>");
    expect(r.quoted).toContain("Old body");
  });

  // A bare forward has nothing but the quote; hiding it would show an empty note.
  it("keeps the quote visible when it is the whole message", () => {
    const r = renderNoteHtml(`<div class="gmail_quote">Forwarded text</div>`, { splitQuoted: true });
    expect(r.main).toContain("Forwarded text");
    expect(r.quoted).toBeNull();
  });
});
