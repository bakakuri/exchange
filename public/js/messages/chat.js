// js/messages/chat.js - one conversation on screen.
//
// openChat(container, conversationId, { onInboxChange }) renders the chat
// into `container` and returns { destroy }. It shows:
//   - a header: back (phones), the other member with their presence, and a
//     menu to see their profile, block / unblock or report them;
//   - the messages, oldest at the top (older pages load on scrolling up),
//     with day separators, grouped bubbles, photos (tap for full size),
//     videos, audio and voice players, documents with a download link,
//     and on one's own messages the time and receipt: sending (clock),
//     sent (✓), seen (✓✓, gradient) - "Seen" under the last one;
//   - the composer: text (Enter sends on computers), attach photos /
//     videos / any file, or record a voice message (the mic replaces the
//     send button while the box is empty).
// New and deleted messages, the other side's "seen" and presence arrive
// through the poller (core/messages-poller.js). Sending is optimistic: a
// message shows at once and is confirmed (or offered for a retry).

import { api } from '../shared/api.js';
import { createEl } from '../shared/dom.js';
import { avatar, icon } from '../shared/icons.js';
import { errorMessage } from '../shared/errors.js';
import { presenceOf } from '../shared/presence.js';
import { store } from '../core/state.js';
import { t } from '../core/i18n.js';
import { focusConversation, setConversationCursor, pollMessagesNow } from '../core/messages-poller.js';
import { formatDuration, formatSize, messageTime, dayLabel, dayKey, isEmojiOnly, kindOf, KIND_ICONS } from './format.js';
import { prepareFile, uploadFile } from './upload.js';
import { startRecording, canRecord, audioPlayer, MAX_VOICE_MS } from './voice.js';

const GROUP_MS = 5 * 60 * 1000;
const coarse = () => window.matchMedia('(pointer: coarse)').matches;
// A v4 UUID for client_id (randomUUID only exists on https and localhost).
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Photo and video size from the sender's meta, as numbers only.
function aspectRatio(meta) {
  const w = Number(meta?.width);
  const h = Number(meta?.height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${Math.round(w)} / ${Math.round(h)}` : '';
}

// Links in text become real links; everything else stays text.
function richText(text) {
  const parts = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  for (const match of String(text).matchAll(re)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(createEl('a', { href: match[0], target: '_blank', rel: 'noopener noreferrer nofollow' }, match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function lightbox(url, name) {
  const dialog = createEl('dialog', { class: 'lightbox', 'aria-label': t('Photo') }, [
    createEl('img', { src: url, alt: '', referrerpolicy: 'no-referrer' }),
    createEl('div', { class: 'lightbox__bar' }, [
      createEl('a', { class: 'glass-btn', href: url, target: '_blank', rel: 'noopener noreferrer', download: name || '' }, [icon('i-download', { size: 16 }), t('Open original')]),
      createEl('button', { type: 'button', class: 'glass-btn glass-btn--icon', 'aria-label': t('Close') }, [icon('i-x', { size: 18 })]),
    ]),
  ]);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
}

export function openChat(container, conversationId, { onInboxChange = () => {} } = {}) {
  const me = store.getState().user?.id;
  const state = {
    conv: null,
    messages: new Map(), // id -> server message
    pending: new Map(), // client_id -> local message
    cursor: 0,
    loadingOlder: false,
    destroyed: false,
    selected: null,
    recorder: null,
  };
  const nodes = new Map(); // key -> element
  let unfocus = null;
  let readTimer = null;

  // ── skeleton ──────────────────────────────────────────────────────────────

  const whoEl = createEl('a', { class: 'chat__who', 'data-link': '' });
  const menuBtn = createEl('button', {
    type: 'button', class: 'icon-button chat__menu-btn', 'aria-label': t('More'), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, [icon('i-ellipsis-vertical', { size: 20 })]);
  const menu = createEl('div', { class: 'chat__menu', role: 'menu' });
  menu.hidden = true;
  const head = createEl('header', { class: 'chat__head' }, [
    createEl('a', { class: 'icon-button chat__back', href: '/messages', 'data-link': '', 'aria-label': t('Back to messages') }, [icon('i-arrow-left', { size: 20 })]),
    whoEl,
    menuBtn,
    menu,
  ]);

  const list = createEl('ol', { class: 'chat__list' });
  const older = createEl('div', { class: 'chat__older' }, [createEl('span', { class: 'spinner', 'aria-hidden': 'true' })]);
  older.hidden = true;
  const scroller = createEl('div', { class: 'chat__scroll', role: 'log', 'aria-live': 'polite', 'aria-label': t('Messages'), tabindex: '0' }, [older, list]);
  const notice = createEl('div', { class: 'chat__notice' });
  notice.hidden = true;

  const textarea = createEl('textarea', { rows: '1', maxlength: '4000', placeholder: t('Message…'), 'aria-label': t('Message'), enterkeyhint: 'send' });
  const sendBtn = createEl('button', { type: 'submit', class: 'composer__send', 'aria-label': t('Send') }, [icon('i-send', { size: 20 })]);
  const micBtn = createEl('button', { type: 'button', class: 'composer__mic', 'aria-label': t('Record a voice message') }, [icon('i-mic', { size: 20 })]);
  const mediaInput = createEl('input', { type: 'file', accept: 'image/*,video/*', multiple: '', hidden: '' });
  const fileInput = createEl('input', { type: 'file', multiple: '', hidden: '' });
  const attachBtn = createEl('button', {
    type: 'button', class: 'icon-button composer__attach', 'aria-label': t('Attach'), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, [icon('i-paperclip', { size: 20 })]);
  const attachMenu = createEl('div', { class: 'composer__menu', role: 'menu' }, [
    createEl('button', { type: 'button', role: 'menuitem', 'data-pick': 'media' }, [
      createEl('span', { class: 'row-icon row-icon--brand' }, [icon('i-image', { size: 18 })]), t('Photo or video')]),
    createEl('button', { type: 'button', role: 'menuitem', 'data-pick': 'file' }, [
      createEl('span', { class: 'row-icon' }, [icon('i-file-text', { size: 18 })]), t('File or document')]),
  ]);
  attachMenu.hidden = true;
  const composerError = createEl('p', { class: 'composer__error', role: 'alert' });
  composerError.hidden = true;
  const recordBar = createEl('div', { class: 'recorder' });
  recordBar.hidden = true;
  const form = createEl('form', { class: 'composer', novalidate: '' }, [
    createEl('div', { class: 'composer__attach-wrap' }, [attachBtn, attachMenu, mediaInput, fileInput]),
    createEl('div', { class: 'composer__field' }, [textarea]),
    sendBtn,
    micBtn,
    recordBar,
  ]);

  const chat = createEl('div', { class: 'chat__inner' }, [head, scroller, notice, composerError, form]);
  container.replaceChildren(chat);
  container.classList.add('is-loading');

  // ── helpers ───────────────────────────────────────────────────────────────

  const other = () => state.conv?.other || {};
  // A message keeps one node from the moment it is typed to the server's
  // copy (same client_id), so confirming it doesn't redraw or re-animate it.
  const keyOf = (m) => (m.local || (m.sender_id === me && m.client_id) ? `c:${m.client_id}` : `m:${m.id}`);
  const otherName = () => other().display_name || other().username || t('Member');
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  const scrollToBottom = (smooth) => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

  function showComposerError(text) {
    composerError.textContent = text;
    composerError.hidden = !text;
    if (text) setTimeout(() => { if (composerError.textContent === text) composerError.hidden = true; }, 6000);
  }

  function ordered() {
    const confirmed = [...state.messages.values()].sort((a, b) => a.seq - b.seq);
    const local = [...state.pending.values()].sort((a, b) => a.created - b.created);
    return [...confirmed, ...local];
  }

  // ── header ────────────────────────────────────────────────────────────────

  let headKey = '';
  function renderHead() {
    const o = other();
    const presence = presenceOf(o);
    const key = JSON.stringify([o.username, otherName(), o.avatar_url, o.is_online, presence?.text, state.conv?.blocked_by_me]);
    if (key === headKey) return;
    headKey = key;
    whoEl.setAttribute('href', o.username ? `/u/${encodeURIComponent(o.username)}` : '#');
    whoEl.replaceChildren(
      avatar(otherName(), { size: 'md', url: o.avatar_url, online: o.is_online === true }),
      createEl('span', { class: 'chat__who-text' }, [
        createEl('strong', {}, otherName()),
        createEl('span', { class: `chat__presence ${presence?.online ? 'is-online' : ''}`.trim() },
          presence ? presence.text : `@${o.username || ''}`),
      ]),
    );

    menu.replaceChildren(
      createEl('a', { role: 'menuitem', href: o.username ? `/u/${encodeURIComponent(o.username)}` : '#', 'data-link': '' }, [icon('i-user', { size: 18 }), t('View profile')]),
      state.conv?.blocked_by_me
        ? createEl('button', { type: 'button', role: 'menuitem', 'data-action': 'unblock' }, [icon('i-user-check', { size: 18 }), t('Unblock')])
        : createEl('button', { type: 'button', role: 'menuitem', 'data-action': 'block', class: 'is-danger' }, [icon('i-ban', { size: 18 }), t('Block')]),
      createEl('button', { type: 'button', role: 'menuitem', 'data-action': 'report', class: 'is-danger' }, [icon('i-flag', { size: 18 }), t('Report')]),
    );
  }

  function renderNotice() {
    const c = state.conv || {};
    let text = null;
    let action = null;
    if (c.blocked_by_me) {
      text = t('You blocked this member. They can\'t write to you, and you can\'t write to them.');
      action = createEl('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'unblock' }, t('Unblock'));
    } else if (c.blocked_me) {
      text = t('You can\'t reply in this conversation.');
    } else if (other().active === false) {
      text = t('This member can\'t receive messages.');
    }
    notice.hidden = !text;
    form.hidden = Boolean(text);
    notice.replaceChildren(...(text ? [icon('i-lock', { size: 16 }), createEl('span', {}, text)] : []), ...(action ? [action] : []));
  }

  // ── message nodes ─────────────────────────────────────────────────────────

  function bubbleContent(m) {
    if (m.deleted_at) {
      return [createEl('p', { class: 'msg__deleted' }, [icon('i-ban', { size: 14 }), t('Message deleted')])];
    }
    const parts = [];
    const url = m.attachment_url || m.previewUrl || null;
    const meta = m.meta || {};
    const ratio = aspectRatio(meta);

    if (m.kind === 'image') {
      const img = createEl('img', { src: m.previewUrl || url || '', alt: m.body || t('Photo'), loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      const photo = createEl('button', { type: 'button', class: 'msg__photo', 'aria-label': t('Open photo') }, [img]);
      if (ratio) photo.style.aspectRatio = ratio;
      if (url && m.attachment_url) photo.addEventListener('click', (e) => { e.stopPropagation(); lightbox(m.attachment_url, m.attachment_name); });
      parts.push(photo);
    } else if (m.kind === 'video') {
      const video = url && m.attachment_url
        ? createEl('video', { class: 'msg__video', src: url, controls: '', preload: 'metadata', playsinline: '' })
        : createEl('div', { class: 'msg__video msg__video--waiting' }, [icon('i-video', { size: 28 })]);
      video.style.aspectRatio = ratio || '16 / 9';
      parts.push(video);
    } else if (m.kind === 'voice' || m.kind === 'audio') {
      if (m.attachment_url) {
        parts.push(audioPlayer({ url: m.attachment_url, durationMs: meta.duration_ms, waveform: m.kind === 'voice' ? meta.waveform : null, name: m.attachment_name }));
      } else {
        parts.push(createEl('div', { class: 'vplayer vplayer--waiting' }, [icon(KIND_ICONS[m.kind], { size: 18 }), formatDuration(meta.duration_ms)]));
      }
      if (m.kind === 'audio') parts.push(createEl('p', { class: 'msg__file-name' }, m.attachment_name));
    } else if (m.kind === 'file') {
      const card = createEl(m.attachment_url ? 'a' : 'div', {
        class: 'msg__file',
        ...(m.attachment_url ? { href: m.attachment_url, target: '_blank', rel: 'noopener noreferrer', download: m.attachment_name || '' } : {}),
      }, [
        createEl('span', { class: 'msg__file-icon' }, [icon('i-file-text', { size: 22 })]),
        createEl('span', { class: 'msg__file-text' }, [
          createEl('strong', {}, m.attachment_name || t('File')),
          createEl('span', {}, formatSize(m.attachment_size)),
        ]),
        m.attachment_url ? icon('i-download', { size: 18, className: 'msg__file-get' }) : '',
      ]);
      parts.push(card);
    }

    if (m.body) {
      const emoji = m.kind === 'text' && isEmojiOnly(m.body);
      parts.push(createEl('p', { class: `msg__text ${emoji ? 'msg__text--emoji' : ''}`.trim() }, richText(m.body)));
    }
    return parts;
  }

  function receipt(m) {
    if (m.local) {
      if (m.status === 'failed') return icon('i-circle-alert', { size: 14, className: 'msg__receipt msg__receipt--failed' });
      return icon('i-clock', { size: 13, className: 'msg__receipt' });
    }
    const seen = m.seq <= (state.conv?.other_read_seq || 0);
    return icon(seen ? 'i-check-check' : 'i-check', { size: 15, className: `msg__receipt ${seen ? 'msg__receipt--seen' : ''}`.trim() });
  }

  function progressRing(m) {
    if (!m.local || m.status !== 'uploading') return '';
    const pct = Math.round((m.progress || 0) * 100);
    return createEl('div', { class: 'msg__progress', style: `--p: ${pct}`, role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': t('Uploading') }, [
      createEl('span', {}, `${pct}%`),
    ]);
  }

  function messageNode(m) {
    const mine = m.local || m.sender_id === me;
    const emojiOnly = m.kind === 'text' && !m.deleted_at && isEmojiOnly(m.body);
    const bubble = createEl('div', {
      class: `msg__bubble msg__bubble--${m.deleted_at ? 'deleted' : m.kind} ${emojiOnly ? 'msg__bubble--emoji' : ''}`.trim(),
    }, [...bubbleContent(m), progressRing(m)]);
    const metaEl = createEl('span', { class: 'msg__meta' }, [
      createEl('time', { datetime: m.created_at }, messageTime(m.created_at)),
      mine ? receipt(m) : '',
    ]);
    bubble.append(metaEl);

    const li = createEl('li', {
      class: `msg ${mine ? 'msg--mine' : 'msg--theirs'} ${m.local ? 'msg--local' : ''}`.trim(),
      'data-key': keyOf(m),
    }, [bubble]);
    li.dataset.version = m.local ? m.status : String(m.change_seq);

    if (m.local && m.status === 'failed') {
      const retry = createEl('button', { type: 'button', class: 'msg__retry' }, [icon('i-repeat', { size: 14 }), m.error || t('Not sent - tap to retry')]);
      retry.addEventListener('click', () => resend(m.client_id));
      li.append(retry);
    }
    if (mine && !m.local && !m.deleted_at) {
      bubble.tabIndex = 0;
      bubble.addEventListener('keydown', (e) => {
        if (e.target !== bubble) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(state.selected === m.id ? null : m.id); }
        if (e.key === 'Delete') { e.preventDefault(); deleteMessage(m.id); }
      });
      bubble.addEventListener('click', (e) => {
        if (e.target.closest('a, button, video, .vplayer')) return;
        select(state.selected === m.id ? null : m.id);
      });
      bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); select(m.id); });
    }
    return li;
  }

  function dayNode(iso) {
    return createEl('li', { class: 'chat__day', 'data-key': `d:${dayKey(iso)}` }, [createEl('span', {}, dayLabel(iso))]);
  }

  // Keyed update: new nodes are inserted, changed ones replaced, nothing
  // that stays is moved - a playing video or voice message keeps playing.
  function render({ initial = false, prepend = false } = {}) {
    const wasNear = nearBottom();
    const oldHeight = scroller.scrollHeight;
    const oldTop = scroller.scrollTop;

    const items = ordered();
    const wanted = [];
    let lastDay = null;
    for (const m of items) {
      const day = dayKey(m.created_at);
      if (day !== lastDay) {
        wanted.push({ key: `d:${day}`, make: () => dayNode(m.created_at) });
        lastDay = day;
      }
      const key = keyOf(m);
      const version = m.local ? m.status : String(m.change_seq);
      wanted.push({ key, version, message: m, make: () => messageNode(m) });
    }

    const keep = new Set(wanted.map((w) => w.key));
    for (const [key, node] of nodes) {
      if (!keep.has(key)) { node.remove(); nodes.delete(key); }
    }

    let ref = list.firstChild;
    for (const w of wanted) {
      let node = nodes.get(w.key);
      if (node && w.version !== undefined && node.dataset.version !== w.version) {
        const fresh = w.make();
        fresh.classList.add('is-settled'); // already on screen: no entrance again
        node.replaceWith(fresh);
        if (ref === node) ref = fresh;
        node = fresh;
        nodes.set(w.key, node);
      }
      if (!node) {
        node = w.make();
        nodes.set(w.key, node);
        list.insertBefore(node, ref);
        continue;
      }
      if (node === ref) ref = ref.nextSibling;
      else list.insertBefore(node, ref);
    }

    // Upload progress is painted in place, so previews don't flicker.
    for (const local of state.pending.values()) {
      if (local.status !== 'uploading') continue;
      const ring = nodes.get(keyOf(local))?.querySelector('.msg__progress');
      if (!ring) continue;
      const pct = Math.round((local.progress || 0) * 100);
      ring.style.setProperty('--p', String(pct));
      ring.setAttribute('aria-valuenow', String(pct));
      ring.firstChild.textContent = `${pct}%`;
    }

    // Grouping: consecutive messages from one side within 5 minutes.
    const msgs = wanted.filter((w) => w.message);
    msgs.forEach((w, i) => {
      const node = nodes.get(w.key);
      const prev = msgs[i - 1]?.message;
      const next = msgs[i + 1]?.message;
      const side = (m) => (m.local || m.sender_id === me ? 'me' : 'them');
      const joins = (a, b) => a && b && side(a) === side(b) && dayKey(a.created_at) === dayKey(b.created_at)
        && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < GROUP_MS;
      node.classList.toggle('is-joined-above', Boolean(joins(prev, w.message)));
      node.classList.toggle('is-joined-below', Boolean(joins(w.message, next)));
    });

    // Receipts on confirmed own messages, and "Seen" under the last one.
    const readSeq = state.conv?.other_read_seq || 0;
    let lastMine = null;
    for (const w of msgs) {
      const m = w.message;
      if (m.local || m.sender_id !== me) continue;
      lastMine = w;
      const node = nodes.get(w.key);
      const current = node.querySelector('.msg__receipt');
      const seen = m.seq <= readSeq;
      if (current && current.classList.contains('msg__receipt--seen') !== seen && !m.deleted_at) current.replaceWith(receipt(m));
    }
    // "Seen" under my last message, when nothing of theirs came after it.
    const seenNode = lastMine && !lastMine.message.deleted_at && lastMine.message.seq <= readSeq
      && !msgs.slice(msgs.indexOf(lastMine) + 1).some((w) => !w.message.local)
      ? nodes.get(lastMine.key) : null;
    list.querySelectorAll('.msg__seen').forEach((el) => { if (el.parentElement !== seenNode) el.remove(); });
    if (seenNode && !seenNode.querySelector(':scope > .msg__seen')) {
      seenNode.append(createEl('span', { class: 'msg__seen' }, t('Seen')));
    }

    // The selected message's actions.
    const selectedMessage = state.selected ? state.messages.get(state.selected) : null;
    const selectedNode = selectedMessage && !selectedMessage.deleted_at ? nodes.get(keyOf(selectedMessage)) : null;
    list.querySelectorAll('.msg.is-selected').forEach((el) => {
      if (el !== selectedNode) { el.classList.remove('is-selected'); el.querySelector(':scope > .msg__actions')?.remove(); }
    });
    if (selectedNode && !selectedNode.querySelector(':scope > .msg__actions')) {
      const del = createEl('button', { type: 'button', class: 'msg__action msg__action--danger' }, [icon('i-trash', { size: 15 }), t('Delete')]);
      del.addEventListener('click', () => deleteMessage(selectedMessage.id));
      selectedNode.classList.add('is-selected');
      selectedNode.append(createEl('div', { class: 'msg__actions' }, [del]));
    }

    if (!items.length) {
      list.replaceChildren(createEl('li', { class: 'chat__hello' }, [
        avatar(otherName(), { size: 'xl', url: other().avatar_url }),
        createEl('strong', {}, otherName()),
        createEl('p', {}, t('No messages yet. Say hello!')),
      ]));
      nodes.clear();
    } else {
      list.querySelector('.chat__hello')?.remove();
    }

    if (initial) scrollToBottom(false);
    else if (prepend) scroller.scrollTop = oldTop + (scroller.scrollHeight - oldHeight);
    else if (wasNear) scrollToBottom(true);
  }

  function select(id) {
    state.selected = id;
    render();
  }

  // ── read receipts (mine) ──────────────────────────────────────────────────

  function markRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (state.destroyed || document.visibilityState !== 'visible' || !state.conv) return;
      const theirs = [...state.messages.values()].filter((m) => m.sender_id !== me);
      const top = theirs.reduce((max, m) => Math.max(max, m.seq), 0);
      if (top <= (state.conv.my_read_seq || 0)) return;
      try {
        const { last_read_seq: read } = await api.messages.read(conversationId, top);
        state.conv.my_read_seq = read;
        onInboxChange();
        pollMessagesNow();
      } catch {
        // tried again with the next message
      }
    }, 350);
  }

  // ── incoming changes ──────────────────────────────────────────────────────

  function absorb(message) {
    const local = message.client_id && message.sender_id === me ? state.pending.get(message.client_id) : null;
    const known = state.messages.get(message.id);
    const previewUrl = local?.previewUrl || known?.previewUrl;
    state.messages.set(message.id, previewUrl && !message.deleted_at ? { ...message, previewUrl } : message);
    if (local) state.pending.delete(message.client_id);
  }

  function onChange(update) {
    if (state.destroyed || !state.conv) return;
    let fresh = false;
    const changes = update.changes || [];
    const readMoved = (update.other_read_seq || 0) !== (state.conv.other_read_seq || 0);
    for (const m of changes) {
      const known = state.messages.get(m.id);
      // A message deleted further back than the loaded pages: nothing to show.
      if (!known && m.deleted_at) { state.cursor = Math.max(state.cursor, Number(m.change_seq) || 0); continue; }
      if (!known && m.sender_id !== me) fresh = true;
      // Keep a signed link we already have if the change didn't touch the file.
      absorb(known && !m.attachment_url && known.attachment_url && !m.deleted_at ? { ...m, attachment_url: known.attachment_url } : m);
      // Only the poll moves the cursor: a send's own answer could be newer
      // than a message from the other side the poll hasn't brought yet.
      state.cursor = Math.max(state.cursor, Number(m.change_seq) || 0);
    }
    setConversationCursor(conversationId, state.cursor);
    const flagsChanged = state.conv.blocked_by_me !== update.blocked_by_me || state.conv.blocked_me !== update.blocked_me;
    Object.assign(state.conv, {
      other_read_seq: update.other_read_seq,
      other: update.other || state.conv.other,
      blocked_by_me: update.blocked_by_me,
      blocked_me: update.blocked_me,
    });
    renderHead();
    if (flagsChanged) renderNotice();
    if (changes.length || readMoved) render();
    if (fresh) markRead();
  }

  // ── sending ───────────────────────────────────────────────────────────────

  async function deliver(local) {
    if (state.destroyed) return;
    try {
      if (local.kind !== 'text' && !local.uploadedPath) {
        local.status = 'uploading';
        local.progress = 0;
        render();
        const { path, upload_url: url } = await api.messages.upload(conversationId, { name: local.name, type: local.type, size: local.blob.size });
        const controller = new AbortController();
        local.abort = () => controller.abort();
        let lastPaint = 0;
        await uploadFile(url, local.blob, {
          signal: controller.signal,
          onProgress: (p) => {
            local.progress = p;
            if (Date.now() - lastPaint > 120) { lastPaint = Date.now(); render(); }
          },
        });
        local.uploadedPath = path;
      }
      local.status = 'sending';
      render();
      const { message } = await api.messages.send(conversationId, {
        kind: local.kind,
        body: local.body || undefined,
        client_id: local.client_id,
        ...(local.kind !== 'text' ? {
          attachment: { path: local.uploadedPath, name: local.name, type: local.type, size: local.blob.size },
          meta: local.meta,
        } : {}),
      });
      if (state.destroyed) return;
      absorb(message);
      render();
      onInboxChange();
      pollMessagesNow();
    } catch (err) {
      if (state.destroyed) return;
      local.status = 'failed';
      local.error = err?.status === 413 || /too large|payload/i.test(String(err?.message))
        ? t('This file is larger than the storage allows.')
        : err?.message === 'aborted' ? t('Cancelled - tap to retry') : t('Not sent - tap to retry');
      if (err?.code) local.error = errorMessage(err, 'Not sent - tap to retry');
      render();
    }
  }

  function addLocal(fields) {
    const local = {
      local: true,
      client_id: newId(),
      created: Date.now(),
      created_at: new Date().toISOString(),
      status: 'sending',
      meta: {},
      ...fields,
    };
    state.pending.set(local.client_id, local);
    render();
    scrollToBottom(true);
    deliver(local);
  }

  function resend(clientId) {
    const local = state.pending.get(clientId);
    if (!local) return;
    local.status = 'sending';
    local.error = null;
    deliver(local);
  }

  function sendText() {
    const body = textarea.value.trim();
    if (!body) return;
    textarea.value = '';
    autoSize();
    syncButtons();
    addLocal({ kind: 'text', body });
    if (!coarse()) textarea.focus();
  }

  async function sendFiles(files) {
    for (const file of files) {
      try {
        const prepared = await prepareFile(file);
        addLocal({
          kind: prepared.kind, blob: prepared.blob, name: prepared.name, type: prepared.type,
          meta: prepared.meta, previewUrl: prepared.previewUrl,
          attachment_name: prepared.name, attachment_size: prepared.blob.size,
        });
      } catch {
        showComposerError(t('That file could not be read.'));
      }
    }
  }

  // ── deleting ──────────────────────────────────────────────────────────────

  async function deleteMessage(id) {
    if (!window.confirm(t('Delete this message for everyone?'))) return;
    const m = state.messages.get(id);
    state.selected = null;
    try {
      await api.messages.remove(id);
      if (m) state.messages.set(id, { ...m, deleted_at: new Date().toISOString(), body: null, attachment_url: null, attachment_path: null, change_seq: `local-${Date.now()}` });
      render();
      onInboxChange();
      pollMessagesNow();
    } catch (err) {
      showComposerError(errorMessage(err, 'Could not delete the message.'));
      render();
    }
  }

  // ── voice ─────────────────────────────────────────────────────────────────

  // Built once per recording; only the time and the bars change after
  // that, so the buttons stay put under a finger.
  function renderRecorder(elapsed, levels) {
    let time = recordBar.querySelector('.recorder__time');
    let bars = recordBar.querySelector('.recorder__bars');
    if (!time || !bars || bars.children.length !== levels.length) {
      time = createEl('span', { class: 'recorder__time', role: 'timer' });
      bars = createEl('span', { class: 'recorder__bars', 'aria-hidden': 'true' }, levels.map(() => createEl('i')));
      recordBar.replaceChildren(
        createEl('button', { type: 'button', class: 'icon-button recorder__cancel', 'aria-label': t('Cancel recording'), 'data-voice': 'cancel' }, [icon('i-trash', { size: 20 })]),
        createEl('span', { class: 'recorder__dot', 'aria-hidden': 'true' }),
        time,
        bars,
        createEl('button', { type: 'button', class: 'composer__send recorder__send', 'aria-label': t('Send voice message'), 'data-voice': 'send' }, [icon('i-send', { size: 20 })]),
      );
    }
    time.textContent = formatDuration(elapsed);
    levels.forEach((l, i) => bars.children[i].style.setProperty('--h', `${Math.max(8, Math.round(l * 100))}%`));
  }

  async function startVoice() {
    if (state.recorder || state.startingVoice) return;
    if (!canRecord()) {
      showComposerError(t('This browser can\'t record voice messages.'));
      return;
    }
    const levels = Array(28).fill(0);
    let elapsed = 0;
    form.classList.add('is-recording');
    recordBar.hidden = false;
    recordBar.replaceChildren();
    renderRecorder(0, levels);
    // The browser may ask for the microphone first: the member can cancel,
    // or leave the chat, while it waits.
    state.startingVoice = true;
    state.voiceCancelled = false;
    let recorder;
    try {
      recorder = await startRecording({
        onLevel: (level) => { levels.push(level); levels.shift(); },
        onTick: (ms) => {
          elapsed = ms;
          if (ms >= MAX_VOICE_MS) finishVoice(true);
        },
      });
    } catch (err) {
      state.startingVoice = false;
      if (state.destroyed || state.voiceCancelled) return;
      form.classList.remove('is-recording');
      recordBar.hidden = true;
      showComposerError(err.message === 'denied'
        ? t('Allow the microphone for this site to record voice messages.')
        : t('No microphone was found.'));
      return;
    }
    state.startingVoice = false;
    if (state.destroyed || state.voiceCancelled) {
      recorder.cancel();
      return;
    }
    state.recorder = recorder;
    const paint = () => {
      if (!state.recorder) return;
      renderRecorder(elapsed, levels);
      state.recorderFrame = setTimeout(paint, 100);
    };
    paint();
  }

  async function finishVoice(send) {
    const recorder = state.recorder;
    if (!recorder) {
      // Still waiting for the microphone: stop before it starts.
      if (state.startingVoice) {
        state.voiceCancelled = true;
        form.classList.remove('is-recording');
        recordBar.hidden = true;
      }
      return;
    }
    state.recorder = null;
    clearTimeout(state.recorderFrame);
    form.classList.remove('is-recording');
    recordBar.hidden = true;
    if (!send) {
      recorder.cancel();
      return;
    }
    const result = await recorder.stop();
    if (result.durationMs < 700 || !result.blob.size) {
      showComposerError(t('Too short - hold on a little longer.'));
      return;
    }
    const ext = result.type.includes('mp4') ? 'm4a' : result.type.includes('ogg') ? 'ogg' : 'webm';
    addLocal({
      kind: 'voice', blob: result.blob, type: result.type, name: `voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`,
      meta: { duration_ms: result.durationMs, waveform: result.waveform },
    });
  }

  // ── composer events ───────────────────────────────────────────────────────

  function autoSize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }
  function syncButtons() {
    const hasText = textarea.value.trim().length > 0;
    sendBtn.hidden = !hasText;
    micBtn.hidden = hasText;
  }
  textarea.addEventListener('input', () => { autoSize(); syncButtons(); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !coarse() && !e.isComposing) {
      e.preventDefault();
      sendText();
    }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); sendText(); });
  micBtn.addEventListener('click', startVoice);
  recordBar.addEventListener('click', (e) => {
    const action = e.target.closest('[data-voice]')?.dataset.voice;
    if (action) finishVoice(action === 'send');
  });

  function toggleMenu(button, panel, open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('[role="menuitem"]')?.focus();
  }
  attachBtn.addEventListener('click', () => toggleMenu(attachBtn, attachMenu));
  attachMenu.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]')?.dataset.pick;
    if (!pick) return;
    toggleMenu(attachBtn, attachMenu, false);
    (pick === 'media' ? mediaInput : fileInput).click();
  });
  for (const input of [mediaInput, fileInput]) {
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.value = '';
      if (files.length) sendFiles(files);
    });
  }
  // Paste or drop files straight into the chat.
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); sendFiles(files); }
  });
  chat.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); chat.classList.add('is-dropping'); } });
  chat.addEventListener('dragleave', (e) => { if (!chat.contains(e.relatedTarget)) chat.classList.remove('is-dropping'); });
  chat.addEventListener('drop', (e) => {
    chat.classList.remove('is-dropping');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { e.preventDefault(); if (!form.hidden) sendFiles(files); }
  });

  // ── header menu: profile, block, report ───────────────────────────────────

  menuBtn.addEventListener('click', () => toggleMenu(menuBtn, menu));

  async function setBlocked(block) {
    if (block && !window.confirm(t('Block {name}? Neither of you will be able to write to the other.', { name: otherName() }))) return;
    try {
      if (block) await api.messages.block(other().id);
      else await api.messages.unblock(other().id);
      state.conv.blocked_by_me = block;
      renderHead();
      renderNotice();
      onInboxChange();
    } catch (err) {
      showComposerError(errorMessage(err, 'That did not work. Please try again.'));
    }
  }

  function report() {
    const category = createEl('select', { class: 'form-input', 'aria-label': t('Category') }, [
      new Option(t('Spam'), 'spam'), new Option(t('Abuse'), 'abuse'),
      new Option(t('Inappropriate content'), 'inappropriate_content'), new Option(t('Fraud'), 'fraud'),
    ]);
    const text = createEl('textarea', { class: 'form-input', rows: '4', maxlength: '2000', placeholder: t('What happened? (at least 10 characters)'), 'aria-label': t('Description') });
    const error = createEl('p', { class: 'form-error', role: 'alert' });
    error.hidden = true;
    const send = createEl('button', { type: 'submit', class: 'btn btn--danger' }, t('Send report'));
    const cancel = createEl('button', { type: 'button', class: 'btn btn--ghost' }, t('Cancel'));
    const dialog = createEl('dialog', { class: 'sheet-dialog', 'aria-labelledby': 'report-title' }, [
      createEl('form', { class: 'sheet-dialog__box', method: 'dialog' }, [
        createEl('h2', { id: 'report-title' }, t('Report {name}', { name: otherName() })),
        createEl('p', { class: 'form-hint' }, t('An admin will look at this conversation.')),
        category, text, error,
        createEl('div', { class: 'sheet-dialog__actions' }, [cancel, send]),
      ]),
    ]);
    const close = () => { dialog.close(); dialog.remove(); };
    cancel.addEventListener('click', close);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (text.value.trim().length < 10) {
        error.textContent = t('Describe what happened (at least 10 characters).');
        error.hidden = false;
        return;
      }
      send.disabled = true;
      try {
        await api.reports.submit({ report_type: category.value, description: text.value.trim(), related_user_id: other().id });
        close();
        showComposerError('');
        notice.hidden = false;
        notice.replaceChildren(icon('i-circle-check', { size: 16 }), createEl('span', {}, t('Thanks - your report was sent.')));
        setTimeout(() => renderNotice(), 4000);
      } catch (err) {
        error.textContent = errorMessage(err, 'Could not send the report.');
        error.hidden = false;
        send.disabled = false;
      }
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  chat.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'block') { toggleMenu(menuBtn, menu, false); setBlocked(true); }
    if (action === 'unblock') { toggleMenu(menuBtn, menu, false); setBlocked(false); }
    if (action === 'report') { toggleMenu(menuBtn, menu, false); report(); }
    // A tap anywhere else closes open menus and the selection.
    if (!e.target.closest('.chat__menu, .chat__menu-btn')) toggleMenu(menuBtn, menu, false);
    if (!e.target.closest('.composer__menu, .composer__attach')) toggleMenu(attachBtn, attachMenu, false);
    if (state.selected && !e.target.closest('.msg--mine .msg__bubble, .msg__actions')) select(null);
  });
  chat.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    toggleMenu(menuBtn, menu, false);
    toggleMenu(attachBtn, attachMenu, false);
    if (state.recorder || state.startingVoice) finishVoice(false);
    if (state.selected) select(null);
  });

  // ── older pages ───────────────────────────────────────────────────────────

  async function loadOlder() {
    if (state.loadingOlder || !state.conv?.has_more) return;
    const oldest = [...state.messages.values()].reduce((min, m) => Math.min(min, m.seq), Infinity);
    if (!Number.isFinite(oldest)) return;
    state.loadingOlder = true;
    older.hidden = false;
    try {
      const { conversation } = await api.messages.conversation(conversationId, { before: oldest });
      if (state.destroyed) return;
      for (const m of conversation.messages) if (!state.messages.has(m.id)) state.messages.set(m.id, m);
      state.conv.has_more = conversation.has_more;
      render({ prepend: true });
    } catch {
      // the next scroll tries again
    } finally {
      state.loadingOlder = false;
      older.hidden = true;
    }
  }
  scroller.addEventListener('scroll', () => {
    if (scroller.scrollTop < 120) loadOlder();
  }, { passive: true });

  // ── start ─────────────────────────────────────────────────────────────────

  syncButtons();
  (async () => {
    try {
      const { conversation } = await api.messages.conversation(conversationId);
      if (state.destroyed) return;
      state.conv = conversation;
      state.cursor = Number(conversation.change_cursor) || 0;
      for (const m of conversation.messages) state.messages.set(m.id, m);
      container.classList.remove('is-loading');
      renderHead();
      renderNotice();
      render({ initial: true });
      markRead();
      unfocus = focusConversation(conversationId, state.cursor, onChange);
      if (!coarse() && !form.hidden) textarea.focus({ preventScroll: true });
    } catch (err) {
      if (state.destroyed) return;
      container.classList.remove('is-loading');
      container.replaceChildren(createEl('div', { class: 'chat__empty' }, [
        icon('i-circle-alert', { size: 28 }),
        createEl('p', {}, errorMessage(err, 'Could not open this conversation.')),
        createEl('a', { class: 'btn btn--sm', href: '/messages', 'data-link': '' }, t('Back to messages')),
      ]));
    }
  })();

  const onVisible = () => { if (document.visibilityState === 'visible') markRead(); };
  document.addEventListener('visibilitychange', onVisible);

  return {
    destroy() {
      state.destroyed = true;
      unfocus?.();
      clearTimeout(readTimer);
      if (state.recorder || state.startingVoice) finishVoice(false);
      for (const local of state.pending.values()) local.abort?.();
      document.removeEventListener('visibilitychange', onVisible);
      container.querySelectorAll('video, audio').forEach((media) => media.pause?.());
      document.querySelectorAll('.vplayer.is-playing').forEach((p) => p.dispatchEvent(new CustomEvent('vplayer:stop')));
    },
  };
}

export { kindOf };
