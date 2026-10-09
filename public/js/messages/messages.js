// js/messages/messages.js - /messages and /messages/:id (023).
//
// The inbox (conversations, newest first: photo with the online dot, name,
// the last message in one line with its receipt, the time, and how many
// are unread) beside the open chat (chat.js). On computers both show side
// by side; on phones the inbox fills the screen and a chat opens over it,
// full screen, with its own back button. Moving between chats keeps the
// inbox in place (the router calls update()).
//
// "New message" searches members and opens (or creates) the conversation.
// The inbox refreshes itself when the poller sees something new.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { avatar, icon } from '../shared/icons.js';
import { errorMessage } from '../shared/errors.js';
import { emptyState } from '../shared/empty-state.js';
import { navigate } from '../core/router.js';
import { eventBus } from '../core/events.js';
import { store } from '../core/state.js';
import { t } from '../core/i18n.js';
import { openChat } from './chat.js';
import { previewText, inboxTime, KIND_ICONS } from './format.js';

let page = null; // everything about the page on screen, for update()/destroy()
const PAGE_SIZE = 30;

function inboxItem(c, activeId) {
  const me = store.getState().user?.id;
  const o = c.other || {};
  const name = o.display_name || o.username || t('Member');
  const last = c.last_message;
  const mine = last && last.sender_id === me;
  const seen = mine && last.seq <= (c.other_read_seq || 0);

  const preview = createEl('span', { class: 'inbox-item__preview' });
  if (mine) {
    preview.append(icon(seen ? 'i-check-check' : 'i-check', { size: 15, className: `inbox-item__receipt ${seen ? 'is-seen' : ''}`.trim() }));
  }
  if (last && !last.deleted_at && last.kind !== 'text') preview.append(icon(KIND_ICONS[last.kind], { size: 14 }));
  preview.append(createEl('span', {}, `${mine ? `${t('You')}: ` : ''}${previewText(last)}`));

  return createEl('li', {}, [
    createEl('a', {
      class: `inbox-item ${c.unread ? 'is-unread' : ''} ${c.id === activeId ? 'is-active' : ''}`.trim(),
      href: `/messages/${c.id}`,
      'data-link': '',
      ...(c.id === activeId ? { 'aria-current': 'page' } : {}),
    }, [
      avatar(name, { size: 'lg', url: o.avatar_url, online: o.is_online === true }),
      createEl('span', { class: 'inbox-item__text' }, [
        createEl('span', { class: 'inbox-item__top' }, [
          createEl('strong', { class: 'inbox-item__name' }, name),
          createEl('time', { class: 'inbox-item__time', datetime: c.last_message_at }, inboxTime(c.last_message_at)),
        ]),
        createEl('span', { class: 'inbox-item__bottom' }, [
          preview,
          c.unread ? createEl('span', { class: 'inbox-item__count', 'aria-label': t('{n} unread', { n: c.unread }) }, c.unread > 99 ? '99+' : String(c.unread)) : '',
          c.blocked_by_me ? icon('i-ban', { size: 14, className: 'inbox-item__blocked' }) : '',
        ]),
      ]),
    ]),
  ]);
}

function renderInbox() {
  if (!page) return;
  const { listEl, searchEl } = page;
  const term = searchEl.value.trim().toLowerCase();
  const items = page.conversations.filter((c) => {
    if (!term) return true;
    const o = c.other || {};
    return `${o.display_name || ''} ${o.username || ''}`.toLowerCase().includes(term);
  });
  listEl.setAttribute('aria-busy', 'false');
  if (!page.conversations.length) {
    listEl.replaceChildren(emptyState({
      iconId: 'i-message-circle',
      title: t('No messages yet'),
      text: t('Write to someone - open their profile or start a new message.'),
      action: { href: '/members', label: t('Find people') },
    }));
    return;
  }
  if (!items.length) {
    listEl.replaceChildren(createEl('li', { class: 'inbox__none' }, t('No conversations match.')));
    return;
  }
  listEl.replaceChildren(...items.map((c) => inboxItem(c, page.activeId)));
  if (!term && !page.endReached && page.conversations.length >= PAGE_SIZE) {
    const more = createEl('button', { type: 'button', class: 'btn btn--ghost btn--sm inbox__more' }, t('Show more'));
    more.addEventListener('click', () => loadMore(more));
    listEl.append(createEl('li', {}, [more]));
  }
}

// The newest page again; older pages already shown stay below it.
async function loadInbox() {
  if (!page) return;
  if (page.loadingInbox) { page.reloadInbox = true; return; }
  const current = page;
  current.loadingInbox = true;
  current.reloadInbox = false;
  try {
    const { conversations: fresh } = await api.messages.conversations({ limit: PAGE_SIZE });
    if (page !== current) return;
    const ids = new Set(fresh.map((c) => c.id));
    const oldest = fresh[fresh.length - 1]?.last_message_at;
    const older = fresh.length < PAGE_SIZE ? [] : current.conversations.filter((c) => !ids.has(c.id) && c.last_message_at < oldest);
    if (fresh.length < PAGE_SIZE) current.endReached = true;
    current.conversations = [...fresh, ...older];
    current.errorEl.hidden = true;
    renderInbox();
  } catch (err) {
    if (page !== current) return;
    current.errorEl.textContent = errorMessage(err, 'Could not load your messages.');
    current.errorEl.hidden = false;
    current.listEl.setAttribute('aria-busy', 'false');
  } finally {
    current.loadingInbox = false;
    if (page === current && current.reloadInbox) loadInbox();
  }
}

async function loadMore(button) {
  const current = page;
  const last = current?.conversations[current.conversations.length - 1];
  if (!last) return;
  button.disabled = true;
  try {
    const { conversations } = await api.messages.conversations({ limit: PAGE_SIZE, before: last.last_message_at });
    if (page !== current) return;
    const known = new Set(current.conversations.map((c) => c.id));
    current.conversations.push(...conversations.filter((c) => !known.has(c.id)));
    if (conversations.length < PAGE_SIZE) current.endReached = true;
    renderInbox();
  } catch (err) {
    if (page !== current) return;
    button.disabled = false;
    current.errorEl.textContent = errorMessage(err, 'Could not load your messages.');
    current.errorEl.hidden = false;
  }
}

// ── new message: find a member ───────────────────────────────────────────────

function renderPeople(members) {
  const box = page.peopleEl;
  const me = store.getState().user?.id;
  const others = members.filter((m) => m.id !== me);
  box.replaceChildren(
    createEl('p', { class: 'inbox__people-title' }, page.searchEl.value.trim() ? t('Members') : t('Start a conversation')),
    ...(others.length
      ? others.map((m) => {
        const btn = createEl('button', { type: 'button', class: 'person-row' }, [
          avatar(m.display_name || m.username, { size: 'md', url: m.avatar_url, online: m.is_online === true }),
          createEl('span', { class: 'person-row__text' }, [
            createEl('strong', {}, m.display_name || m.username),
            createEl('span', {}, `@${m.username}`),
          ]),
          icon('i-send', { size: 16 }),
        ]);
        btn.addEventListener('click', () => startWith(m.id, btn));
        return btn;
      })
      : [createEl('p', { class: 'inbox__none' }, t('No members found'))]),
  );
}

async function searchPeople() {
  if (!page?.peopleOpen) return;
  const term = page.searchEl.value.trim();
  const id = (page.peopleRequest = (page.peopleRequest || 0) + 1);
  try {
    const { members } = await api.members.list({ search: term || undefined, limit: 12 });
    if (page && page.peopleOpen && id === page.peopleRequest) renderPeople(members);
  } catch {
    // the list stays as it was
  }
}

function setPeopleOpen(open) {
  page.peopleOpen = open;
  page.peopleEl.hidden = !open;
  page.newBtn.setAttribute('aria-expanded', String(open));
  page.root.classList.toggle('is-finding', open);
  page.searchEl.placeholder = open ? t('Search members') : t('Search');
  if (open) {
    page.peopleEl.replaceChildren(createEl('span', { class: 'spinner', 'aria-hidden': 'true' }));
    searchPeople();
    page.searchEl.focus();
  }
  renderInbox();
}

async function startWith(userId, button) {
  button.disabled = true;
  try {
    const { conversation_id: id } = await api.messages.start({ user_id: userId });
    setPeopleOpen(false);
    page.searchEl.value = '';
    navigate(`/messages/${id}`);
  } catch (err) {
    button.disabled = false;
    page.errorEl.textContent = errorMessage(err, 'Could not start the conversation.');
    page.errorEl.hidden = false;
  }
}

// ── chat pane ────────────────────────────────────────────────────────────────

function showChat(id) {
  page.chat?.destroy();
  page.chat = null;
  page.activeId = id || null;
  page.root.classList.toggle('has-chat', Boolean(id));
  if (id) {
    page.chatEl.replaceChildren();
    page.chat = openChat(page.chatEl, id, { onInboxChange: () => loadInbox() });
  } else {
    page.chatEl.replaceChildren(page.placeholder.cloneNode(true));
  }
  renderInbox();
  fitToViewport();
}

// Phones: the open chat fills what is left above the on-screen keyboard.
function fitToViewport() {
  const vv = window.visualViewport;
  if (!vv || !page) return;
  page.root.style.setProperty('--vvh', `${vv.height}px`);
  page.root.style.setProperty('--vvt', `${vv.offsetTop}px`);
}

// ── page lifecycle (router) ──────────────────────────────────────────────────

export async function init(params = {}) {
  const root = qs('[data-messages]');
  if (!root) return;
  destroy(); // never two at once
  page = {
    root,
    listEl: qs('[data-inbox-list]'),
    searchEl: qs('[data-inbox-search]'),
    errorEl: qs('[data-inbox-error]'),
    peopleEl: qs('[data-people]'),
    newBtn: qs('[data-new-chat]'),
    chatEl: qs('[data-chat]'),
    placeholder: qs('[data-chat]').firstElementChild.cloneNode(true),
    conversations: [],
    activeId: null,
    chat: null,
    peopleOpen: false,
    endReached: false,
  };
  const current = page;

  let debounce;
  page.searchEl.addEventListener('input', () => {
    renderInbox();
    clearTimeout(debounce);
    debounce = setTimeout(searchPeople, 250);
  });
  page.newBtn.addEventListener('click', () => setPeopleOpen(!page.peopleOpen));

  page.offUpdate = eventBus.on('messages:update', ({ changed, incoming }) => {
    if (changed || incoming.length) loadInbox();
  });
  page.onViewport = () => fitToViewport();
  window.visualViewport?.addEventListener('resize', page.onViewport);
  window.visualViewport?.addEventListener('scroll', page.onViewport);

  showChat(params.id);
  await loadInbox();

  // A link to someone: /messages?to=<user id>
  const to = new URLSearchParams(location.search).get('to');
  if (to && !params.id && page === current) {
    try {
      const { conversation_id: id } = await api.messages.start({ user_id: to });
      if (page === current) navigate(`/messages/${id}`, { replace: true });
    } catch (err) {
      if (page !== current) return;
      current.errorEl.textContent = errorMessage(err, 'Could not start the conversation.');
      current.errorEl.hidden = false;
    }
  }
}

export function update(params = {}) {
  if (!page) return;
  if ((params.id || null) !== page.activeId) showChat(params.id);
}

export function destroy() {
  if (!page) return;
  page.chat?.destroy();
  page.offUpdate?.();
  window.visualViewport?.removeEventListener('resize', page.onViewport);
  window.visualViewport?.removeEventListener('scroll', page.onViewport);
  page = null;
}
