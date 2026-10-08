// js/auth/login.js - behavior for the /login route fragment.
import { login } from './auth.js';
import { navigate } from '../core/router.js';
import { qs } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';

export function init() {
  const form = qs('#login-form');
  const errorEl = qs('#login-error');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await login({
        email: form.email.value.trim(),
        password: form.password.value,
      });
      navigate('/');
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Sign in failed. Please try again.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
