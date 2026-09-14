(function(){
  'use strict';
  const q=s=>document.querySelector(s);
  const qa=s=>[...document.querySelectorAll(s)];
  const go=id=>{if(typeof window.showView==='function'){window.showView(id);return true}return false};
  function stop(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}
  function init(){
    /* One delegated click layer keeps navigation working even if a legacy bind failed. */
    document.addEventListener('click',function(e){
      const target=e.target.closest('[data-view],[data-view-target]');
      if(target){
        const id=target.dataset.view||target.dataset.viewTarget;
        if(id&&go(id)) stop(e);
        return;
      }
      const menu=e.target.closest('#menuBtn');
      if(menu){if(typeof window.openDrawer==='function') window.openDrawer(); stop(e); return;}
      const backdrop=e.target.closest('#drawerBackdrop');
      if(backdrop){if(typeof window.closeDrawer==='function') window.closeDrawer(); stop(e); return;}
      const topAvatar=e.target.closest('#topAvatar');
      if(topAvatar){go('profile-settings'); stop(e); return;}
      const close=e.target.closest('#modalClose');
      if(close){if(typeof window.closeModal==='function') window.closeModal(); stop(e); return;}
      const auth=e.target.closest('#authBtn');
      if(auth){
        if(typeof window.logout==='function' && window.state?.user){ window.logout(); }
        else if(typeof window.auth==='function'){ window.auth(false); }
        stop(e); return;
      }
      const add=e.target.closest('#addProfile');
      if(add){if(typeof window.addProfile==='function') window.addProfile(); stop(e); return;}
    },true);

    /* Safety net for the dynamically rendered task confirmation buttons. */
    document.addEventListener('click',function(e){
      const b=e.target.closest('button[data-task-id]');
      if(!b||b.disabled||b.dataset.repairBound==='1') return;
      if(typeof window.completeTask==='function'){
        b.dataset.repairBound='1';
        window.completeTask(b.dataset.taskId);
      }
    },false);

    /* Make the visible UI clickable if an old overlay accidentally captured touches. */
    qa('.view, .main, .mobile-dock').forEach(el=>{el.style.pointerEvents='auto'});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
