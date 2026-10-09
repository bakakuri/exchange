// js/admin/admin-user.js - behavior for /admin/users/:id.
//
// The member at a glance (cover, photo, name, role, status, field of work,
// when they were last active - admins see it even when it's hidden from
// members), then:
//  1. Profile clean-up (022): username, name, bio, field of work, remove
//     the photo or cover - with a reason the member is notified of
//     (PATCH /api/admin/users/:id/profile);
//  2. Role / status (PATCH /api/admin/users/:id);
//  3. Credit adjustment (POST /api/admin/users/:id/credits);
//  4. History: credits, campaigns, tasks and admin actions.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { shortDate, shortDateTime, timeAgo } from '../shared/time.js';
import { avatar, icon } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { MEMBER_CATEGORIES, categoryChip } from '../shared/member-categories.js';
import { campaignStatusLabel } from '../campaigns/status.js';
import { statusLabel } from '../submissions/status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { renderEntries as renderLedger } from '../credits/credits.js';
import { roleLabel, userStatusLabel } from './labels.js';
import { mountAdminTabs } from './admin-tabs.js';

const ONLINE_MS = 5 * 60 * 1000;

// ── the member at a glance ──────────────────────────────────────────────────

function lastSeen(user) {
  if (!user.last_seen_at) return t('Not seen yet');
  if (Date.now() - new Date(user.last_seen_at).getTime() < ONLINE_MS) return t('Online');
  return t('Last seen {time}', { time: timeAgo(user.last_seen_at) });
}

function renderProfile(el, user) {
  const name = user.display_name || user.username || t('(no name)');
  const online = user.last_seen_at && Date.now() - new Date(user.last_seen_at).getTime() < ONLINE_MS;

  const cover = createEl('div', { class: `profile-hero__cover ${user.cover_url ? 'has-photo' : ''}`.trim() });
  if (user.cover_url) cover.append(createEl('img', { class: 'profile-hero__cover-img', src: user.cover_url, alt: '', referrerpolicy: 'no-referrer' }));

  const meta = createEl('p', { class: 'profile-hero__meta' }, [
    createEl('span', {}, `@${user.username || '—'}`),
    createEl('span', { class: `admin-user-role admin-user-role--${user.role}` }, roleLabel(user.role)),
    createEl('span', { class: `admin-user-status admin-user-status--${user.status}` }, userStatusLabel(user.status)),
  ]);
  const chip = categoryChip(user.category);
  if (chip) meta.append(chip);
  meta.append(createEl('span', { class: `presence ${online ? 'presence--online' : ''}`.trim() }, [
    createEl('span', { class: 'presence__dot', 'aria-hidden': 'true' }), lastSeen(user),
  ]));
  if (user.show_online === false) {
    meta.append(createEl('span', { class: 'admin-hint-chip', title: t('Members don\'t see this member\'s online status.') }, [icon('i-eye-off', { size: 14 }), t('Status hidden')]));
  }

  const links = createEl('div', { class: 'profile-hero__links' }, [
    createEl('a', { class: 'btn btn--sm', href: `/u/${encodeURIComponent(user.username)}`, 'data-link': '' }, [icon('i-eye', { size: 16 }), t('Public profile')]),
    createEl('a', { class: 'btn btn--sm', href: `/admin/messages?to=${encodeURIComponent(user.username)}`, 'data-link': '' }, [icon('i-send', { size: 16 }), t('Send a message')]),
  ]);

  const stats = user._stats
    ? createEl('p', { class: 'admin-user-detail__stats' },
      `${tn(Number(user._stats.total_completions), '{n} completion', '{n} completions')}, ${t('{n} pending review', { n: Number(user._stats.pending_verifications) })}`)
    : '';

  el.replaceChildren(
    createEl('div', { class: 'profile-hero profile-hero--admin' }, [
      cover,
      createEl('div', { class: 'profile-hero__body' }, [
        createEl('div', { class: 'profile-hero__avatar' }, [avatar(name, { size: 'xl', url: user.avatar_url, online })]),
        createEl('div', { class: 'profile-hero__who' }, [createEl('h1', { class: 'profile-hero__name' }, name), meta, stats]),
        links,
      ]),
    ]),
    createEl('dl', { class: 'admin-user-detail__meta' }, [
      createEl('dt', {}, t('Credits')), createEl('dd', {}, formatNumber(Number(user.credits))),
      createEl('dt', {}, t('Level')), createEl('dd', {}, `${Number(user.level)} (${formatNumber(Number(user.xp))} XP)`),
      createEl('dt', {}, t('Joined')), createEl('dd', {}, shortDate(user.created_at)),
      createEl('dt', {}, t('Country')), createEl('dd', {}, user.country || '—'),
      createEl('dt', {}, t('Referral code')), createEl('dd', {}, user.referral_code || '—'),
    ]),
  );
}

// ── profile clean-up ────────────────────────────────────────────────────────

function photoToggle(kind, url, name) {
  const id = `admin-remove-${kind}`;
  const preview = kind === 'avatar'
    ? avatar(name, { size: 'lg', url })
    : createEl('span', { class: `admin-photo__cover ${url ? '' : 'admin-photo__cover--empty'}`.trim() },
      url ? [createEl('img', { src: url, alt: '', referrerpolicy: 'no-referrer' })] : []);
  const box = createEl('div', { class: 'admin-photo' }, [preview]);
  if (url) {
    box.append(createEl('label', { class: 'admin-photo__remove', for: id }, [
      createEl('input', { type: 'checkbox', id, name: `remove_${kind}` }),
      kind === 'avatar' ? t('Remove the photo') : t('Remove the cover'),
    ]));
  } else {
    box.append(createEl('span', { class: 'admin-photo__none' }, kind === 'avatar' ? t('No photo') : t('No cover')));
  }
  return box;
}

function initProfileForm(userId, user, onUpdated) {
  const form = qs('#admin-profile-form');
  const errorEl = qs('#admin-profile-error');
  const successEl = qs('#admin-profile-success');
  if (!form) return;

  if (!form.category.options.length) {
    form.category.append(new Option(t('Not set'), ''));
    for (const c of MEMBER_CATEGORIES) form.category.append(new Option(c.label, c.value));
  }
  form.username.value = user.username || '';
  form.display_name.value = user.display_name || '';
  form.bio.value = user.bio || '';
  form.category.value = user.category || '';
  const name = user.display_name || user.username;
  qs('[data-admin-photos]').replaceChildren(photoToggle('avatar', user.avatar_url, name), photoToggle('cover', user.cover_url, name));

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    // Only what changed is sent.
    const changes = {};
    const username = form.username.value.trim();
    if (username !== (user.username || '')) changes.username = username;
    for (const field of ['display_name', 'bio']) {
      const value = form[field].value.trim();
      if (value !== (user[field] || '')) changes[field] = value;
    }
    if (form.category.value !== (user.category || '')) changes.category = form.category.value;
    if (form.remove_avatar?.checked) changes.remove_avatar = true;
    if (form.remove_cover?.checked) changes.remove_cover = true;

    if (!Object.keys(changes).length) {
      errorEl.textContent = t('Nothing has changed.');
      errorEl.hidden = false;
      return;
    }
    const reason = form.reason.value.trim();
    if (reason.length < 3) {
      errorEl.textContent = t('Write a short reason (at least 3 characters).');
      errorEl.hidden = false;
      form.reason.focus();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const { user: updated } = await api.admin.updateProfile(userId, { ...changes, reason });
      form.reason.value = '';
      successEl.hidden = false;
      onUpdated(updated);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not update the profile.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  };
}

// ── update role / status form ───────────────────────────────────────────────

function initUpdateForm(userId, currentUser, onUpdated) {
  const form = qs('#admin-update-form');
  const errorEl = qs('#admin-update-error');
  const successEl = qs('#admin-update-success');
  if (!form) return;

  form.role.value = currentUser.role;
  form.status.value = currentUser.status;

  form.onsubmit = async (e) => {
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
      onUpdated();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Update failed.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  };
}

// ── credit adjustment form ──────────────────────────────────────────────────

function initCreditForm(userId, onUpdated) {
  const form = qs('#admin-credit-form');
  const errorEl = qs('#admin-credit-error');
  const successEl = qs('#admin-credit-success');
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api.admin.adjustCredits(userId, {
        amount: parseInt(form.amount.value, 10),
        reason: form.reason.value.trim(),
      });
      successEl.hidden = false;
      form.amount.value = '';
      form.reason.value = '';
      onUpdated();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Credit adjustment failed.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  };
}

// ── history ─────────────────────────────────────────────────────────────────

const AUDIT_LABELS = {
  'user.updated': () => t('Role or status changed'),
  'user.profile_moderated': () => t('Profile changed by a moderator'),
  'credit.admin_adjustment': () => t('Credits adjusted'),
  'admin.message': () => t('Message sent'),
};

function historyList(items, renderItem, empty) {
  const list = createEl('ul', { class: 'admin-history' });
  if (!items.length) list.append(emptyState({ iconId: 'i-inbox', title: empty }));
  for (const item of items) list.append(renderItem(item));
  return list;
}

function renderHistory(el, history = {}) {
  const panels = [
    {
      key: 'ledger',
      label: t('Credits'),
      render: () => {
        const list = createEl('ul', { class: 'ledger-list admin-history' });
        if (history.ledger?.length) renderLedger(list, history.ledger);
        else list.append(emptyState({ iconId: 'i-coins', title: t('No credit movements yet') }));
        return list;
      },
    },
    {
      key: 'campaigns',
      label: t('Campaigns'),
      render: () => historyList(history.campaigns || [], (c) => createEl('li', { class: 'admin-history__row' }, [
        createEl('span', { class: 'admin-history__main' }, [
          createEl('strong', {}, c.title),
          createEl('span', {}, `${t('{done} of {total} done', { done: formatNumber(c.completed_count), total: formatNumber(c.desired_completions) })} · ${shortDate(c.created_at)}`),
        ]),
        createEl('span', { class: `campaign-status campaign-status--${c.status}` }, campaignStatusLabel(c.status)),
      ]), t('No campaigns yet')),
    },
    {
      key: 'tasks',
      label: t('Tasks'),
      render: () => historyList(history.completions || [], (c) => createEl('li', { class: 'admin-history__row' }, [
        createEl('span', { class: 'admin-history__main' }, [
          createEl('strong', {}, c.campaign_title),
          createEl('span', {}, `${taskActionLabel(c.task_type, c.platform)} · ${tn(c.reward_amount, '{n} credit', '{n} credits')} · ${shortDate(c.created_at)}`),
        ]),
        createEl('span', { class: `submission-status submission-status--${c.status}` }, statusLabel(c.status)),
      ]), t('No tasks yet')),
    },
    {
      key: 'audit',
      label: t('Admin actions'),
      render: () => historyList(history.audit || [], (a) => createEl('li', { class: 'admin-history__row' }, [
        createEl('span', { class: 'admin-history__main' }, [
          createEl('strong', {}, AUDIT_LABELS[a.action]?.() || a.action),
          createEl('span', {}, [a.reason ? `“${a.reason}” · ` : '', a.actor ? `@${a.actor.username} · ` : '', shortDateTime(a.created_at)].join('')),
        ]),
      ]), t('No admin actions yet')),
    },
  ];

  const tabs = createEl('div', { class: 'history-tabs', role: 'tablist', 'aria-label': t('History') });
  const panel = createEl('div', { class: 'history-panel', role: 'tabpanel' });
  const buttons = panels.map((p, i) => {
    const btn = createEl('button', { type: 'button', role: 'tab', id: `history-tab-${p.key}`, class: 'history-tab', 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1' }, p.label);
    btn.addEventListener('click', () => select(i));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : panels.length - 1)) % panels.length;
        select(next);
        buttons[next].focus();
      }
    });
    return btn;
  });
  function select(index) {
    buttons.forEach((b, i) => { b.setAttribute('aria-selected', i === index ? 'true' : 'false'); b.tabIndex = i === index ? 0 : -1; });
    panel.setAttribute('aria-labelledby', buttons[index].id);
    panel.replaceChildren(panels[index].render());
  }
  tabs.append(...buttons);
  el.replaceChildren(tabs, panel);
  select(0);
}

// ── init ────────────────────────────────────────────────────────────────────

export async function init({ id } = {}) {
  mountAdminTabs();
  const profileEl = qs('[data-admin-user-profile]');
  const loadingEl = qs('[data-admin-user-loading]');
  const errorEl = qs('#admin-user-error');
  const formsEl = qs('[data-admin-user-forms]');
  if (!profileEl || !id) return;

  function show(user) {
    renderProfile(profileEl, user);
    initProfileForm(id, user, show);
    initUpdateForm(id, user, refresh);
    initCreditForm(id, refresh);
    renderHistory(qs('[data-admin-history]'), user._history);
  }

  async function refresh() {
    try {
      const { user } = await api.admin.user(id);
      show(user);
    } catch {
      // The change itself went through; the page just shows older numbers.
    }
  }

  try {
    const { user } = await api.admin.user(id);
    if (loadingEl) loadingEl.hidden = true;
    show(user);
    if (formsEl) formsEl.hidden = false;
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = errorMessage(err, 'Could not load user.');
      errorEl.hidden = false;
    }
  }
}
