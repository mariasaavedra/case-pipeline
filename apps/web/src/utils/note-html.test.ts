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

  it("loads e-mail images lazily and without a Referer", () => {
    const { main } = renderNoteHtml(`<p>Logo</p><img src="https://sender.example/logo.png">`);
    expect(main).toContain('referrerpolicy="no-referrer"');
    expect(main).toContain('loading="lazy"');
  });

  // The tree is cut and re-serialized after the first pass; markup that parses
  // differently the second time (mutation XSS) must not survive either string.
  it("leaves nothing executable in either half after a quote split", () => {
    const payloads = [
      `<svg><p><style><img src=x onerror=alert(1)></style></p></svg>`,
      `<math><mtext><table><mglyph><style><img src=x onerror=alert(2)></style></mglyph></table></mtext></math>`,
      `<noscript><p title="</noscript><img src=x onerror=alert(3)>"></p></noscript>`,
      `<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(4) src>">`,
    ];
    for (const p of payloads) {
      const r = renderNoteHtml(`<p>New ${p}</p><div class="gmail_quote"><p>From: x</p>${p}</div>`, { splitQuoted: true });
      for (const half of [r.main, r.quoted ?? ""]) {
        const doc = document.createElement("div");
        doc.innerHTML = half;
        const handlers = Array.from(doc.querySelectorAll("*"))
          .flatMap((el) => Array.from(el.attributes, (a) => a.name))
          .filter((n) => /^on/i.test(n));
        expect(handlers).toEqual([]);
        expect(doc.querySelector("script")).toBeNull();
      }
    }
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
