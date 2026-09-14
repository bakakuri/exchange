(() => {
  'use strict';
  if (window.__exchangeProfileActivityInstalled) return;
  window.__exchangeProfileActivityInstalled = true;
  const q=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money=n=>Number(n||0).toLocaleString('ka-GE');
  const labels={task_reward:'დავალების ჯილდო',promotion_spend:'კამპანიის ხარჯი',promotion_refund:'კამპანიის თანხის დაბრუნება',opening_balance:'საწყისი ბალანსი',admin_adjustment:'ადმინისტრატორის კორექცია',signup_bonus:'საწყისი ბონუსი'};
  const stateNow=()=>{try{return typeof state!=='undefined'?state:window.state||null}catch{return window.state||null}};
  function render(){const s=stateNow(),host=q('#profileExtra .profile-activity');if(!host||!s?.user)return;const rows=Array.isArray(s.transactions)?s.transactions.slice(0,8):[];host.innerHTML=rows.length?rows.map(x=>{const amount=Number(x.amount||0),positive=amount>0,title=labels[x.type]||x.type||'ოპერაცია',date=x.created_at?new Date(x.created_at).toLocaleString('ka-GE'):'';return `<div class="profile-activity-item"><span class="profile-activity-icon ${positive?'is-positive':'is-negative'}">${positive?'↑':'↓'}</span><div><strong>${esc(title)}</strong><small>${esc(date)}</small></div><span class="profile-activity-value ${positive?'is-positive':'is-negative'}">${positive?'+':''}${money(amount)}</span></div>`}).join(''):'<div class="empty">ბოლო აქტივობა ჯერ არ არის.</div>'}
  function boot(){render();document.addEventListener('exchange:data-ready',render);document.addEventListener('exchange:session-ready',render);const target=q('#profile-settings');if(target&&typeof MutationObserver!=='undefined'&&!target.dataset.activityFixBound){target.dataset.activityFixBound='1';new MutationObserver(render).observe(target,{childList:true,subtree:true})}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
