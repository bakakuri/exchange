// server/services/locale.service.js
// Picks a starting language from the visitor's country. The country comes
// from the CDN's geo header (Vercel sets x-vercel-ip-country on every
// request; Cloudflare sets cf-ipcountry). Countries not listed here get
// language: null and the browser decides (phone language, then English).
// A language the person picks themselves always wins over this guess.

const LANGUAGE_BY_COUNTRY = Object.freeze({
  GE: 'ka', // Georgia
  RU: 'ru', // Russia
  BY: 'ru', // Belarus
  KZ: 'ru', // Kazakhstan
  KG: 'ru', // Kyrgyzstan
});

const COUNTRY_RE = /^[A-Z]{2}$/;

// "XX"/"T1" style placeholders (unknown, Tor) are not countries.
const NOT_A_COUNTRY = new Set(['XX', 'T1', 'ZZ']);

function normalizeCountry(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return COUNTRY_RE.test(code) && !NOT_A_COUNTRY.has(code) ? code : null;
}

function languageForCountry(country) {
  return (country && LANGUAGE_BY_COUNTRY[country]) || null;
}

function detect(headers = {}) {
  const country = normalizeCountry(headers['x-vercel-ip-country'] || headers['cf-ipcountry']);
  return { country, language: languageForCountry(country) };
}

module.exports = { detect, normalizeCountry, languageForCountry, LANGUAGE_BY_COUNTRY };
