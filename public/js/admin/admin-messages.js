// js/admin/admin-messages.js - /admin/messages (022).
// A message to every active member or to one (by username), delivered as
// a notification (admin_send_message()), and the list of what was sent.
// /admin/messages?to=nino opens with that member already filled in.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { shortDateTime } from '../shared/time.js';
import { t, tn } from '../core/i18n.js';
import { mountAdminTabs } from './admin-tabs.js';
import { celebrate } from '../shared/motion.js';

function messageRow(m) {
  const audience = m.audience === 'everyone'
    ? createEl('span', { class: 'audience-chip audience-chip--all' }, [icon('i-users-round', { size: 14 }), t('Everyone')])
    : createEl('span', { class: 'audience-chip' }, [icon('i-user', { size: 14 }), m.recipient ? `@${m.recipient.username}` : t('One member')]);
  return createEl('li', { class: 'admin-row admin-message' }, [
    createEl('div', { class: 'admin-row__main' }, [
      createEl('span', { class: 'row-icon row-icon--brand' }, [icon('i-send', { size: 18 })]),
      createEl('div', { class: 'admin-row__text' }, [
        createEl('p', { class: 'admin-row__title' }, m.title),
        m.body ? createEl('p', { class: 'admin-message__body' }, m.body) : '',
        createEl('p', { class: 'admin-row__meta' }, [
          audience,
          createEl('span', {}, tn(m.recipients, 'delivered to {n} member', 'delivered to {n} members')),
          createEl('span', {}, shortDateTime(m.created_at)),
          m.sender ? createEl('span', {}, t('by @{username}', { username: m.sender.username })) : '',
        ]),
      ]),
    ]),
  ]);
}

export async function init() {
  mountAdminTabs();
  const form = qs('#admin-message-form');
  const listEl = qs('[data-admin-list]');
  const listError = qs('[data-admin-error]');
  if (!form || !listEl) return;
  const errorEl = qs('#admin-message-error');
  const successEl = qs('#admin-message-success');
  const userField = qs('[data-admin-message-user]');

  async function loadSent() {
    listError.hidden = true;
    try {
      const { messages } = await api.admin.messages();
      listEl.innerHTML = '';
      for (const m of messages) listEl.append(messageRow(m));
      if (!messages.length) {
        listEl.append(emptyState({ iconId: 'i-send', title: t('No messages yet'), text: t('Messages you send appear here.') }));
      }
    } catch (err) {
      listError.textContent = errorMessage(err, 'Could not load sent messages.');
      listError.hidden = false;
    }
  }

  const audience = () => form.querySelector('input[name="audience"]:checked')?.value || 'everyone';
  function syncAudience() {
    userField.hidden = audience() !== 'one';
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'audience') syncAudience(); });

  const to = new URLSearchParams(location.search).get('to');
  if (to) {
    form.querySelector('input[value="one"]').checked = true;
    form.username.value = to;
  }
  syncAudience();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    const toOne = audience() === 'one';
    const username = form.username.value.trim().replace(/^@+/, '');
    const title = form.title.value.trim();
    if (toOne && !username) { errorEl.textContent = t('Enter the member\'s username.'); errorEl.hidden = false; form.username.focus(); return; }
    if (!title) { errorEl.textContent = t('Write a title.'); errorEl.hidden = false; form.title.focus(); return; }
    if (!toOne && !window.confirm(t('Send this to every member?'))) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const { sent } = await api.admin.sendMessage({
        audience: toOne ? 'member' : 'everyone',
        ...(toOne ? { username } : {}),
        title,
        body: form.body.value.trim(),
      });
      successEl.textContent = tn(sent, 'Sent to {n} member.', 'Sent to {n} members.');
      successEl.hidden = false;
      celebrate(submitBtn, { pieces: 16 });
      form.title.value = '';
      form.body.value = '';
      loadSent();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not send the message.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  await loadSent();
}
