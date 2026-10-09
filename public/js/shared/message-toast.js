// js/shared/message-toast.js
// A new message while the member is elsewhere on the site: a card drops
// in from the top for 3 seconds with the sender, their photo and the whole
// message (a photo shows as a picture). A bar shows the time left; it
// waits while hovered or touched. Tap it to open the chat, swipe it up
// (or press ×) to dismiss. At most three at once.

import { createEl } from './dom.js';
import { avatar, icon } from './icons.js';
import { t } from '../core/i18n.js';

const SHOW_MS = 3000;
const MAX_TOASTS = 3;
let stack = null;

function container() {
  if (stack?.isConnected) return stack;
  stack = createEl('div', { class: 'toast-stack', role: 'region', 'aria-label': t('New messages'), 'aria-live': 'polite' });
  document.body.append(stack);
  return stack;
}

function dismiss(card) {
  if (!card.isConnected || card.classList.contains('is-leaving')) return;
  card.classList.add('is-leaving');
  const done = () => card.remove();
  card.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
}

/**
 * @param {{ name: string, avatarUrl?: string, text: string, imageUrl?: string,
 *           iconId?: string, onOpen?: () => void }} toast
 */
export function showMessageToast({ name, avatarUrl, text, imageUrl, iconId, onOpen }) {
  const root = container();
  while (root.children.length >= MAX_TOASTS) root.firstElementChild.remove();

  const close = createEl('button', { type: 'button', class: 'toast__close', 'aria-label': t('Dismiss') }, [icon('i-x', { size: 16 })]);
  const content = createEl('div', { class: 'toast__content' }, [
    createEl('p', { class: 'toast__head' }, [
      createEl('strong', { class: 'toast__name' }, name),
      createEl('span', { class: 'toast__time' }, t('now')),
    ]),
  ]);
  if (imageUrl) {
    content.append(createEl('img', { class: 'toast__image', src: imageUrl, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' }));
  }
  if (text) {
    content.append(createEl('p', { class: 'toast__text' }, iconId ? [icon(iconId, { size: 15 }), text] : text));
  }

  const card = createEl('div', { class: 'toast', role: 'status', tabindex: '0' }, [
    avatar(name, { size: 'md', url: avatarUrl }),
    content,
    close,
    createEl('span', { class: 'toast__timer', 'aria-hidden': 'true' }),
  ]);
  card.style.setProperty('--toast-ms', `${SHOW_MS}ms`);

  // Time left: paused while the member is looking at it.
  let remaining = SHOW_MS;
  let startedAt = Date.now();
  let timer = setTimeout(() => dismiss(card), remaining);
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining -= Date.now() - startedAt;
    card.classList.add('is-paused');
  };
  const resume = () => {
    if (timer || !card.isConnected) return;
    startedAt = Date.now();
    timer = setTimeout(() => dismiss(card), Math.max(remaining, 600));
    card.classList.remove('is-paused');
  };
  card.addEventListener('pointerenter', pause);
  card.addEventListener('pointerleave', resume);
  card.addEventListener('focusin', pause);
  card.addEventListener('focusout', resume);

  // Swipe up or sideways to dismiss; a plain tap opens the chat.
  let start = null;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.toast__close')) return;
    start = { x: e.clientX, y: e.clientY };
    card.setPointerCapture(e.pointerId);
    pause();
  });
  card.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = Math.min(0, e.clientY - start.y);
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    card.style.opacity = String(Math.max(0.2, 1 - (Math.abs(dx) + Math.abs(dy)) / 220));
  });
  card.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 70 || dy < -40) {
      card.classList.add(dy < -40 ? 'is-swiped-up' : 'is-swiped');
      dismiss(card);
      return;
    }
    card.style.transform = '';
    card.style.opacity = '';
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      dismiss(card);
      onOpen?.();
      return;
    }
    resume();
  });
  card.addEventListener('pointercancel', () => { start = null; card.style.transform = ''; card.style.opacity = ''; resume(); });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { dismiss(card); onOpen?.(); }
    if (e.key === 'Escape') dismiss(card);
  });
  close.addEventListener('click', (e) => { e.stopPropagation(); dismiss(card); });

  root.append(card);
  return card;
}
