(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const getState = () => { try { return typeof state !== 'undefined' ? state : null; } catch { return null; } };

  function cleanCancelledActions() {
    const s = getState();
    if (!s?.promotions) return;
    $$('#promotionList .promotion-row').forEach((row, index) => {
      const promotion = s.promotions[index];
      if (!promotion || promotion.status !== 'cancelled') return;
      $$('button', row)
        .filter(button => /გაუქმება|cancel/i.test(button.textContent || ''))
        .forEach(button => button.remove());
      $$('small', row).forEach(small => {
        small.textContent = (small.textContent || '').replace(/\b(?:cancelled|გაუქმებული)\b/gi, 'გაუქმებული');
      });
    });
  }

  function init() {
    const list = $('#promotionList');
    if (!list || typeof MutationObserver === 'undefined') return;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; cleanCancelledActions(); });
    });
    observer.observe(list, { childList: true, subtree: true });
    cleanCancelledActions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
