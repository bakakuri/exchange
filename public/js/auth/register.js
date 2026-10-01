// js/auth/register.js - behavior for the /register route fragment.
import { register } from './auth.js';
import { navigate } from '../core/router.js';
import { qs } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';

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

      if (result.session) {
        navigate('/');
      } else {
        // Project has email confirmation enabled - there's no session
        // yet, so send them to sign in once they've confirmed.
        successEl.textContent = 'Account created. Check your email to confirm it, then sign in.';
        successEl.hidden = false;
        form.reset();
      }
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Registration failed. Please try again.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
