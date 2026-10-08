// js/auth/register.js - behavior for the /register route fragment.
import { register } from './auth.js';
import { navigate } from '../core/router.js';
import { qs } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { t } from '../core/i18n.js';

// Server notes may arrive as "CODE: message" straight from Postgres.
const noteText = (note) => t(String(note).replace(/^[A-Z_]+:\s*/, ''));

export function init() {
  const form = qs('#register-form');
  const errorEl = qs('#register-error');
  const successEl = qs('#register-success');
  if (!form) return;

  // Referral links point people here as /register?ref=CODE - prefill it
  // rather than making them retype a code someone shared with them.
  const refCode = new URLSearchParams(location.search).get('ref');
  if (refCode && form.referral_code) form.referral_code.value = refCode;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const result = await register({
        email: form.email.value.trim(),
        password: form.password.value,
        username: form.username.value.trim() || undefined,
        referral_code: form.referral_code.value.trim() || undefined,
      });

      // Non-fatal notes from the server (taken username, bad referral code).
      const notes = [result.usernameWarning, result.referralWarning].filter(Boolean).map(noteText).join(' ');

      if (result.session && !notes) {
        navigate('/');
      } else if (result.session) {
        successEl.textContent = `${t('Account created.')} ${notes}`;
        successEl.hidden = false;
        setTimeout(() => navigate('/'), 3000);
      } else {
        // Project has email confirmation enabled - there's no session
        // yet, so send them to sign in once they've confirmed.
        successEl.textContent = `${t('Account created. Check your email to confirm it, then sign in.')}${notes ? ` ${notes}` : ''}`;
        successEl.hidden = false;
        form.reset();
      }
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Registration failed. Please try again.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
