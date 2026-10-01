// server/validators/referral.validator.js
// Mirrors generate_referral_code() (011_referrals.sql: upper(substr(md5(...),
// 1, 8))), which always produces 8 uppercase alphanumeric characters -
// accepting either case here and normalizing in the service keeps a
// pasted-in-lowercase code from failing the database's exact-match lookup
// for no real reason.

const CODE_RE = /^[A-Za-z0-9]{8}$/;

function validateClaim(body) {
  const errors = [];

  if (!body.code || !CODE_RE.test(String(body.code))) {
    errors.push('code must be an 8-character referral code');
  }

  return errors;
}

module.exports = { validateClaim };
