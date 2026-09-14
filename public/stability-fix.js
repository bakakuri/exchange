(function(){
  'use strict';
  function text(id,value){const e=document.getElementById(id);if(e)e.textContent=String(value??'')}
  function run(fn){try{if(typeof fn==='function')fn()}catch(e){console.warn('Exchange UI recovery:',e)}}
  function repair(){
    try{
      const s=state;
      if(s&&s.profile){
        const c=Number(s.profile.credits||0).toLocaleString('ka-GE');
        ['credits','walletCredits','promoBalance','heroCredits'].forEach(id=>text(id,c));
      }
      text('completedCount',s?.completed?.size||0);
      text('profileCount',s?.socialProfiles?.length||0);
      const earned=(s?.transactions||[]).filter(x=>x.type==='task_reward').reduce((a,x)=>a+Number(x.amount||0),0);
      text('earnedCount',earned.toLocaleString('ka-GE'));
      text('taskBadge',(s?.tasks||[]).filter(t=>!s.user||t.owner_id!==s.user.id).length);
    }catch(e){console.warn('Exchange state recovery:',e)}
    run(window.renderTasks);run(window.renderProfiles);run(window.renderPromotions);run(window.analytics);run(window.wallet);run(window.preview);
  }
  function install(){
    if(typeof window.loadData!=='function'){setTimeout(install,50);return}
    if(window.loadData.__exchangeSafe)return;
    const original=window.loadData;
    async function safeLoadData(){
      try{return await original.apply(this,arguments)}
      catch(e){
        console.error('Exchange loadData recovery:',e);
        repair();
        if(typeof window.toast==='function')window.toast('მონაცემები ნაწილობრივ ჩაიტვირთა. UI აღდგენილია.');
        return null;
      }
    }
    safeLoadData.__exchangeSafe=true;
    window.loadData=safeLoadData;
  }
  function nav(){
    const old=document.querySelector('.mobile-dock');if(old)old.hidden=true;
    const visibleMenu=document.querySelector('#mobile-dock-menu');
    const mobileMenu=document.querySelector('#mobileMenu');
    if(mobileMenu&&mobileMenu.hidden){
      const candidates=document.querySelectorAll('#mobileMenu');
      candidates.forEach((b,i)=>{if(i>0)b.hidden=false});
    }
  }
  install();
  nav();
})();
