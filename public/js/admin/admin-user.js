// js/admin/admin-user.js - behavior for /admin/users/:id.
//
// Shows a user's full profile, then two admin forms:
//  1. Update role / status (PATCH /api/admin/users/:id)
//  2. Credit adjustment (POST /api/admin/users/:id/credits)

import { api } from '../shared/api.js';
import { navigate } from '../core/router.js';
import { qs, createEl, escapeHtml } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';
import { roleLabel, userStatusLabel } from './labels.js';

// ── profile rendering ───────────────────────────────────────────────────────

function renderProfile(el, user) {
  const statsSection = user._stats
    ? `<p class="admin-user-detail__stats">
         ${escapeHtml(tn(Number(user._stats.total_completions), '{n} completion', '{n} completions'))}, ${escapeHtml(t('{n} pending review', { n: Number(user._stats.pending_verifications) }))}
       </p>`
    : '';

  el.innerHTML = `
    <div class="admin-user-detail__header">
      <div>
        <h2 class="admin-user-detail__name">${escapeHtml(user.display_name || user.username || t('(no name)'))}</h2>
        <p class="admin-user-detail__username">@${escapeHtml(user.username || '—')}</p>
        ${statsSection}
      </div>
      <div class="admin-user-detail__badges">
        <span class="admin-user-role admin-user-role--${escapeHtml(user.role)}">${escapeHtml(roleLabel(user.role))}</span>
        <span class="admin-user-status admin-user-status--${escapeHtml(user.status)}">${escapeHtml(userStatusLabel(user.status))}</span>
      </div>
    </div>
    <dl class="admin-user-detail__meta">
      <dt>${escapeHtml(t('Credits'))}</dt><dd>${formatNumber(Number(user.credits))}</dd>
      <dt>${escapeHtml(t('Level'))}</dt><dd>${Number(user.level)} (${formatNumber(Number(user.xp))} XP)</dd>
      <dt>${escapeHtml(t('Joined'))}</dt><dd>${escapeHtml(shortDate(user.created_at))}</dd>
      <dt>${escapeHtml(t('Referral code'))}</dt><dd>${escapeHtml(user.referral_code || '—')}</dd>
    </dl>
  `.trim();
}

// ── update role / status form ───────────────────────────────────────────────

function initUpdateForm(userId, currentUser) {
  const form = qs('#admin-update-form');
  const errorEl = qs('#admin-update-error');
  const successEl = qs('#admin-update-success');
  if (!form) return;

  // Pre-fill with current values.
  if (form.role) form.role.value = currentUser.role;
  if (form.status) form.status.value = currentUser.status;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api.admin.updateUser(userId, {
        role: form.role.value,
        status: form.status.value,
        reason: form.reason.value.trim(),
      });
      successEl.hidden = false;
      form.reason.value = '';
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Update failed.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── credit adjustment form ──────────────────────────────────────────────────

function initCreditForm(userId, profileEl) {
  const form = qs('#admin-credit-form');
  const errorEl = qs('#admin-credit-error');
  const successEl = qs('#admin-credit-success');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const amount = parseInt(form.amount.value, 10);

    try {
      await api.admin.adjustCredits(userId, {
        amount,
        reason: form.reason.value.trim(),
      });
      successEl.hidden = false;
      form.amount.value = '';
      form.reason.value = '';
      // Refresh profile to show updated credit balance.
      const { user: updated } = await api.admin.user(userId);
      renderProfile(profileEl, updated);
      initUpdateForm(userId, updated);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Credit adjustment failed.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── init ───────────────────────────────────────────────────────────────────

export async function init({ id } = {}) {
  const profileEl = qs('[data-admin-user-profile]');
  const loadingEl = qs('[data-admin-user-loading]');
  const errorEl = qs('#admin-user-error');
  const formsEl = qs('[data-admin-user-forms]');

  if (!profileEl || !id) return;

  try {
    const { user } = await api.admin.user(id);
    if (loadingEl) loadingEl.hidden = true;

    renderProfile(profileEl, user);
    if (formsEl) formsEl.hidden = false;

    initUpdateForm(id, user);
    initCreditForm(id, profileEl);
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = errorMessage(err, 'Could not load user.');
      errorEl.hidden = false;
    }
  }
}
