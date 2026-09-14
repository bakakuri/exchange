(() => {
  'use strict';
  if (window.__exchangeLoadDataFinalizerInstalled) return;
  window.__exchangeLoadDataFinalizerInstalled = true;

  const core = typeof window.loadData === 'function' ? window.loadData : null;
  if (!core) {
    console.error('Exchange: final loadData service is unavailable.');
    return;
  }

  let inFlight = null;
  let sequence = 0;
  const unifiedLoadData = async function (...args) {
    if (inFlight) return inFlight;
    const current = ++sequence;
    inFlight = Promise.resolve().then(() => core.apply(this, args)).then(result => {
      document.dispatchEvent(new CustomEvent('exchange:data-ready', {
        detail: { state: window.state || null, result, sequence: current }
      }));
      return result;
    });
    try { return await inFlight; } finally { inFlight = null; }
  };

  window.exchangeLoadData = unifiedLoadData;
  window.__exchangeCoreLoadData = core;

  const descriptor = Object.getOwnPropertyDescriptor(window, 'loadData');
  if (descriptor?.writable) {
    window.loadData = unifiedLoadData;
  } else {
    console.warn('Exchange: loadData is not writable; using exchangeLoadData facade.');
  }

  document.dispatchEvent(new CustomEvent('exchange:data-service-ready', {
    detail: { loadData: unifiedLoadData, core }
  }));
})();
