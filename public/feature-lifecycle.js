(() => {
  'use strict';
  if (window.__exchangeFeatureLifecycleInstalled) return;
  window.__exchangeFeatureLifecycleInstalled = true;
  const original = window.loadData;
  if (typeof original !== 'function') {
    console.error('Exchange lifecycle: core loadData is unavailable.');
    return;
  }
  const emit = result => document.dispatchEvent(new CustomEvent('exchange:data-ready',{detail:{state:window.state||null,result}}));
  const coreLoadData = async function(...args){const result=await original.apply(this,args);emit(result);return result};
  window.__exchangeCoreLoadData=original;
  window.__exchangeDataReady=emit;
  Object.defineProperty(window,'loadData',{configurable:true,enumerable:true,get(){return coreLoadData},set(next){if(next!==coreLoadData)console.warn('Exchange lifecycle: feature attempted to replace core loadData; ignored.')}});
  document.documentElement.dataset.stage4Guards='1';
  document.addEventListener('click',event=>{const target=event.target.closest?.('[data-stage4-go]');if(!target)return;const id=target.dataset.stage4Go;if(id&&typeof window.showView==='function'){event.preventDefault();window.showView(id)}},false);
  document.dispatchEvent(new CustomEvent('exchange:lifecycle-ready',{detail:{loadData:coreLoadData}}));
})();
