// Swallow the browser's "Script error." for errors with no file name, before
// the app loads. A file of its own rather than an inline <script>, because the
// Content-Security-Policy (security-headers.conf) allows scripts from this
// origin only.
/* global window */
window.addEventListener("error", function (e) {
  if (e.filename === "") e.preventDefault();
});
