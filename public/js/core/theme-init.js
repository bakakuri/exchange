// js/core/theme-init.js
// Classic (non-module) script, loaded synchronously at the top of <head>
// so two things are right before the first paint. It has to be a file:
// the CSP forbids inline scripts.
//   1. Theme - stored choice, else the device setting (no white flash).
//   2. Layout hint - if a session is stored, start in the signed-in app
//      layout so members don't see the visitor header flash first.
//      auth-nav.js confirms or corrects data-auth once the session is
//      checked with the server.
// The theme button lives in js/core/theme.js; both read the same key.
(function () {
  var root = document.documentElement;
  var theme = null;
  var hasSession = false;
  try {
    theme = localStorage.getItem('exchange.theme');
    hasSession = Boolean(localStorage.getItem('exchange.session'));
  } catch (e) {
    // storage blocked (private mode) - fall back to defaults
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-auth', hasSession ? 'in' : 'out');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
})();
