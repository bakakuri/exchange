(function(){
  'use strict';
  if(window.__exchangeTaskClickCompat)return;
  window.__exchangeTaskClickCompat=true;
  window.addEventListener('click',function(e){
    const b=e.target&&e.target.closest?e.target.closest('button[data-task-id]'):null;
    if(!b)return;
    if(b.dataset.stage4Busy==='1'){
      b.dataset.stage4Busy='';
      b.disabled=false;
    }
  },true);
})();
