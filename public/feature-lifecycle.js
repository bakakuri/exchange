(() => {
  'use strict';

  if (window.__exchangeFeatureLifecycleInstalled) return;
  window.__exchangeFeatureLifecycleInstalled = true;

  const original = window.loadData;
  if (typeof original !== 'function') {
    console.error('Exchange lifecycle: core loadData is unavailable.');
    return;
  }

  const emit = (result) => {
    document.dispatchEvent(new CustomEvent('exchange:data-ready', {
      detail: { state: window.state || null, result }
    }));
  };

  const coreLoadData = async function(...args) {
    const result = await original.apply(this, args);
    emit(result);
    return result;
  };

  window.__exchangeCoreLoadData = original;
  window.__exchangeDataReady = emit;

  Object.defineProperty(window, 'loadData', {
    configurable: true,
    enumerable: true,
    get() { return coreLoadData; },
    set(next) {
      if (next !== coreLoadData) {
        console.warn('Exchange lifecycle: feature attempted to replace core loadData; ignored.');
      }
    }
  });

  document.dispatchEvent(new CustomEvent('exchange:lifecycle-ready', {
    detail: { loadData: coreLoadData }
  }));
})();
