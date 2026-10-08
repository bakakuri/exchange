// js/auth/password-reset.js - behavior for the /password-reset route
// fragment. It covers both halves of the flow with one page:
//   1. request:  visitor enters their email, we ask the server to send
//                a recovery link.
//   2. confirm:  visitor arrives back here from that emailed link, which
//                Supabase appends as a #access_token=...&type=recovery
//                hash fragment; they set a new password.

import { requestPasswordReset, confirmPasswordReset } from './auth.js';
import { navigate } from '../core/router.js';
import { qs } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';

function recoveryTokenFromUrl() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return hash.get('type') === 'recovery' ? hash.get('access_token') : null;
}

export function init() {
  const token = recoveryTokenFromUrl();
  const requestSection = qs('[data-reset-request]');
  const confirmSection = qs('[data-reset-confirm]');

  if (token) {
    requestSection.hidden = true;
    confirmSection.hidden = false;
    wireConfirmForm(token);
  } else {
    requestSection.hidden = false;
    confirmSection.hidden = true;
    wireRequestForm();
  }
}

function wireRequestForm() {
  const form = qs('#reset-request-form');
  const errorEl = qs('#reset-request-error');
  const successEl = qs('#reset-request-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await requestPasswordReset(form.email.value.trim());
      // Same message whether or not the email is registered - the
      // backend is anti-enumeration by design (auth.controller.js) and
      // the frontend shouldn't undo that by reacting differently.
      successEl.hidden = false;
      form.reset();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Something went wrong. Please try again.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function wireConfirmForm(token) {
  const form = qs('#reset-confirm-form');
  const errorEl = qs('#reset-confirm-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await confirmPasswordReset(token, form.password.value);
      navigate('/login', { replace: true });
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not reset your password. The link may have expired - request a new one.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
