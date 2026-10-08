// js/referrals/referrals.js - behavior for the /referrals route.
//
// Three sections:
//  1. Share  – user's own referral code + copy-to-clipboard link
//  2. Claim  – enter a code from a friend (hidden once they already have a
//              referrer, detected from the loaded referral list)
//  3. List   – everyone the user has referred + pending/rewarded status,
//              and the entry showing who referred them (if any)

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { t } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';

// ── helpers ────────────────────────────────────────────────────────────────

function buildShareLink(code) {
  return `${location.origin}/register?ref=${encodeURIComponent(code)}`;
}

const fmtDate = shortDate;

// ── share section ──────────────────────────────────────────────────────────

function initShare(code) {
  const codeEl = qs('[data-referral-code]');
  const linkInput = qs('[data-referral-link]');
  const copyBtn = qs('[data-referral-copy]');

  if (!codeEl) return;

  const link = buildShareLink(code);
  codeEl.textContent = code;
  if (linkInput) linkInput.value = link;

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        copyBtn.textContent = t('Copied!');
        setTimeout(() => { copyBtn.textContent = t('Copy link'); }, 2000);
      } catch {
        // Clipboard API unavailable (e.g. non-HTTPS dev). Show the link.
        if (linkInput) linkInput.select();
      }
    });
  }
}

// ── claim section ──────────────────────────────────────────────────────────

function initClaim(onClaimed) {
  const form = qs('#referral-claim-form');
  const errorEl = qs('#referral-claim-error');
  const successEl = qs('#referral-claim-success');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const code = form.code.value.trim().toUpperCase();

    try {
      await api.referrals.claim(code);
      successEl.hidden = false;
      form.reset();
      // Reload the list so the new entry appears and the claim form hides.
      onClaimed();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Failed to claim referral code.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── list section ───────────────────────────────────────────────────────────

function renderReferralItem(ref) {
  const other = ref.other_user;
  const name = other?.display_name || other?.username || t('(unknown user)');
  const isReferred = ref.direction === 'referred'; // current user was referred by 'name'

  const directionLabel = isReferred ? t('Referred by') : t('You referred');

  const statusClass = ref.reward_issued_at
    ? 'referral-item__status--rewarded'
    : 'referral-item__status--pending';
  const statusText = ref.reward_issued_at ? t('Rewarded') : t('Pending');

  return createEl('li', { class: 'referral-item' }, [
    createEl('div', { class: 'referral-item__header' }, [
      createEl('span', { class: 'referral-item__direction' }, directionLabel),
      createEl('span', { class: `referral-item__status ${statusClass}` }, statusText),
    ]),
    createEl('p', { class: 'referral-item__user' }, name),
    createEl('p', { class: 'referral-item__date' }, fmtDate(ref.created_at)),
  ]);
}

function renderList(listEl, emptyEl, referrals) {
  listEl.innerHTML = '';

  if (!referrals.length) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const ref of referrals) {
    listEl.append(renderReferralItem(ref));
  }
}

// ── pagination ─────────────────────────────────────────────────────────────

let currentCursor = null;
let isLoading = false;

async function loadMore(listEl, emptyEl, loadMoreBtn, loadErrorEl) {
  if (isLoading) return;
  isLoading = true;
  loadMoreBtn.disabled = true;

  try {
    const { referrals, next_cursor } = await api.referrals.mine(
      currentCursor ? { before: currentCursor } : {}
    );

    currentCursor = next_cursor;
    loadMoreBtn.hidden = !next_cursor;

    if (referrals.length) {
      emptyEl.hidden = true;
      for (const ref of referrals) {
        listEl.append(renderReferralItem(ref));
      }
    } else if (!listEl.children.length) {
      emptyEl.hidden = false;
    }
  } catch (err) {
    loadErrorEl.textContent = errorMessage(err, 'Could not load referrals.');
    loadErrorEl.hidden = false;
  } finally {
    isLoading = false;
    loadMoreBtn.disabled = false;
  }
}

// ── init ───────────────────────────────────────────────────────────────────

export async function init() {
  const claimSection = qs('#referral-claim-section');
  const listEl = qs('[data-referral-list]');
  const emptyEl = qs('[data-referral-empty]');
  const loadMoreBtn = qs('[data-referral-load-more]');
  const loadErrorEl = qs('#referral-list-error');
  const errorEl = qs('#referrals-error');

  // ── share section always renders from the cached store ─────────────────
  const user = store.getState().user;
  const code = user?.referral_code;

  if (code) {
    initShare(code);
  } else {
    const shareSection = qs('#referral-share-section');
    if (shareSection) shareSection.hidden = true;
  }

  // Reset pagination state (init() is called each time the route loads).
  currentCursor = null;

  // ── initial list load ──────────────────────────────────────────────────
  let alreadyReferred = false;

  try {
    const { referrals, next_cursor } = await api.referrals.mine();
    currentCursor = next_cursor;

    renderList(listEl, emptyEl, referrals);

    if (next_cursor && loadMoreBtn) {
      loadMoreBtn.hidden = false;
    }

    // If there's any entry where the current user was referred by someone,
    // they already have a referrer - hide the claim form (UX only, not a
    // security boundary - the API enforces the one-referrer rule itself).
    alreadyReferred = referrals.some((r) => r.direction === 'referred');
  } catch (err) {
    if (loadErrorEl) {
      loadErrorEl.textContent = errorMessage(err, 'Could not load referrals.');
      loadErrorEl.hidden = false;
    }
    if (errorEl) {
      errorEl.textContent = errorMessage(err, 'Could not load referrals.');
      errorEl.hidden = false;
    }
  }

  // Hide the claim form if the user was already referred.
  if (claimSection) {
    claimSection.hidden = alreadyReferred;
  }

  // ── wire up claim form ─────────────────────────────────────────────────
  initClaim(async () => {
    // After a successful claim, reload from the top and re-evaluate.
    currentCursor = null;
    listEl.innerHTML = '';
    if (loadMoreBtn) loadMoreBtn.hidden = true;

    try {
      const { referrals, next_cursor } = await api.referrals.mine();
      currentCursor = next_cursor;
      renderList(listEl, emptyEl, referrals);
      if (next_cursor && loadMoreBtn) loadMoreBtn.hidden = false;

      // Now they have a referrer - hide the claim section.
      if (claimSection && referrals.some((r) => r.direction === 'referred')) {
        claimSection.hidden = true;
      }
    } catch {
      // Non-critical: the success message is already showing.
    }
  });

  // ── load-more pagination ───────────────────────────────────────────────
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () =>
      loadMore(listEl, emptyEl, loadMoreBtn, loadErrorEl)
    );
  }
}
