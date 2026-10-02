// js/core/theme-init.js
// Classic (non-module) script, loaded synchronously at the top of <head>
// so the theme is set before the first paint - dark-mode visitors never
// see a white flash. It has to be a file: the CSP forbids inline scripts.
// The toggle button and live updates live in js/core/theme.js; both read
// the same storage key.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('exchange.theme');
  } catch (e) {
    // storage blocked (private mode) - fall back to the device setting
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
})();
