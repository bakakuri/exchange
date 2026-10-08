// js/shared/motion.js - the few animations that need script:
//   countUp(el, to, format)   a number rolls to its new value
//   celebrate(anchor)         a burst of gradient confetti from an element
// Both do nothing extra when the visitor asked for reduced motion: the
// number is simply set, and no confetti appears.

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const running = new WeakMap();

/**
 * Rolls el's number from what it shows now (or 0) to `to` over ~0.9 s.
 * `format(n)` turns the number into the text to show.
 */
export function countUp(el, to, format = (n) => String(n), { duration = 900 } = {}) {
  if (!el) return;
  const target = Number(to) || 0;
  const from = Number(el.dataset.countValue ?? 0) || 0;
  el.dataset.countValue = String(target);
  cancelAnimationFrame(running.get(el));
  if (reduced() || from === target || document.hidden) {
    el.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(Math.round(from + (target - from) * eased));
    if (p < 1) running.set(el, requestAnimationFrame(step));
  };
  running.set(el, requestAnimationFrame(step));
}

const COLORS = ['#6d5dfc', '#b44cf0', '#ff6a95', '#38bdf8', '#fbbf4a', '#3ddc97'];

/** A short burst of confetti from the middle of `anchor` (an element). */
export function celebrate(anchor, { pieces = 28 } = {}) {
  if (reduced() || !anchor?.getBoundingClientRect) return;
  const box = anchor.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${box.left + box.width / 2}px`;
  layer.style.top = `${box.top + box.height / 2}px`;
  for (let i = 0; i < pieces; i += 1) {
    const bit = document.createElement('i');
    const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.5;
    const distance = 70 + Math.random() * 90;
    bit.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    bit.style.setProperty('--y', `${Math.sin(angle) * distance - 40}px`);
    bit.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    bit.style.setProperty('--d', `${Math.round(Math.random() * 120)}ms`);
    bit.style.background = COLORS[i % COLORS.length];
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    layer.append(bit);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1500);
}
