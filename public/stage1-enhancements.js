(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];

  const getState = () => {
    try { return typeof state !== 'undefined' ? state : null; }
    catch { return null; }
  };

  const cleanCancelledActions = () => {
    const s = getState();
    if (!s?.promotions) return;

    qa('#promotionList .promotion-row').forEach((row, index) => {
      const promotion = s.promotions[index];
      if (!promotion) return;

      if (promotion.status === 'cancelled') {
        qa('button', row)
          .filter(button => /გაუქმება|cancel/i.test(button.textContent || ''))
          .forEach(button => button.remove());

        qa('small', row).forEach(small => {
          small.textContent = (small.textContent || '').replace(/\b(?:cancelled|გაუქმებული)\b/gi, 'გაუქმებული');
        });
      }
    });
  };

  setInterval(cleanCancelledActions, 500);
})();
