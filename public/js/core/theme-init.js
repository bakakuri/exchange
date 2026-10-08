// js/core/theme-init.js
// Classic (non-module) script, loaded synchronously at the top of <head>
// so three things are right before the first paint. It has to be a file:
// the CSP forbids inline scripts.
//   1. Theme - stored choice, else the device setting (no white flash).
//   2. Layout hint - if a session is stored, start in the signed-in app
//      layout so members don't see the visitor header flash first.
//      auth-nav.js confirms or corrects data-auth once the session is
//      checked with the server.
//   3. Language hint - <html lang> from the stored choice, account or
//      country guess. Unless that is English (the language index.html is
//      written in), the page stays hidden until core/language.js has
//      translated it (data-i18n="pending"; base.css reveals it anyway
//      after a moment if scripts fail).
// The theme button lives in js/core/theme.js; both read the same key.
(function () {
  var root = document.documentElement;
  var theme = null;
  var hasSession = false;
  var lang = null;
  var ok = function (code) { return code === 'ka' || code === 'ru' || code === 'en'; };
  try {
    theme = localStorage.getItem('exchange.theme');
    var session = localStorage.getItem('exchange.session');
    hasSession = Boolean(session);
    lang = localStorage.getItem('exchange.lang');
    if (!ok(lang) && session) lang = (JSON.parse(session).user || {}).language;
    if (!ok(lang)) lang = (JSON.parse(localStorage.getItem('exchange.lang.geo') || 'null') || {}).language;
  } catch (e) {
    // storage blocked (private mode) or unreadable - fall back to defaults
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-auth', hasSession ? 'in' : 'out');
  if (ok(lang)) root.setAttribute('lang', lang);
  root.setAttribute('data-i18n', lang === 'en' ? 'ready' : 'pending');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
})();
