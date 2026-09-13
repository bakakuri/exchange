(function(){
  'use strict';
  const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money=v=>Number(v||0).toLocaleString('ka-GE');
  const S=()=>{try{return typeof state!=='undefined'?state:null}catch{return null}};
  const labels={signup_bonus:'საწყისი ბონუსი',task_reward:'დავალების ჯილდო',promotion_spend:'კამპანიის ხარჯი',promotion_refund:'კამპანიის თანხის დაბრუნება',opening_balance:'საწყისი ბალანსი',admin_adjustment:'ადმინისტრატორის კორექცია'};
  const statuses={active:'აქტიური',paused:'დაპაუზებული',completed:'დასრულებული',cancelled:'გაუქმებული'};
  let walletSearch='';

  function dashboard(){
    const host=q('#dashboard .metric-grid');if(!host)return;let box=q('#stage4Dashboard');
    if(!box){box=document.createElement('section');box.id='stage4Dashboard';box.className='stage4-dashboard';host.insertAdjacentElement('afterend',box)}
    const s=S();if(!s?.user){box.hidden=true;return}box.hidden=false;const tx=s.transactions||[],p=s.promotions||[];
    const earned=tx.filter(x=>x.type==='task_reward').reduce((a,x)=>a+Number(x.amount||0),0),spent=tx.filter(x=>x.type==='promotion_spend').reduce((a,x)=>a+Math.abs(Number(x.amount||0)),0),active=p.filter(x=>x.status==='active').length,done=s.completed?.size||0;
    box.innerHTML=`<div class="stage4-dash-head"><div><span>აქტივობის შეჯამება</span><strong>შენი Exchange შედეგები</strong></div><button type="button" class="stage4-link" data-stage4-go="analytics">ანალიტიკა →</button></div><div class="stage4-dash-grid"><article><small>დაგროვილი</small><b>+${money(earned)}</b><em>კრედიტი</em></article><article><small>დახარჯული</small><b>${money(spent)}</b><em>კრედიტი</em></article><article><small>აქტიური კამპანიები</small><b>${money(active)}</b><em>კამპანია</em></article><article><small>შესრულებული</small><b>${money(done)}</b><em>დავალება</em></article></div>`;
  }

  function tasks(){
    qa('#allTasks .task-card, #dashboardTasks .task-card').forEach(card=>{
      if(card.dataset.stage4Enhanced==='1')return;card.dataset.stage4Enhanced='1';const top=card.querySelector('.task-top');const reward=card.querySelector('.reward');const small=card.querySelector('small');
      if(top){const meta=document.createElement('div');meta.className='stage4-task-meta';if(reward)meta.appendChild(reward);if(small){const s=document.createElement('span');s.textContent=small.textContent||'';meta.appendChild(s);small.remove()}top.appendChild(meta)}
      const actions=card.querySelector('.task-actions');if(actions&&!actions.querySelector('.stage4-task-info')){const b=document.createElement('button');b.type='button';b.className='stage4-task-info';b.textContent='დეტალები';b.addEventListener('click',()=>taskInfo(card));actions.appendChild(b)}
    });
  }

  function taskInfo(card){const s=S();if(!s||typeof window.modal!=='function')return;const id=card.querySelector('[data-task-id]')?.dataset.taskId;const t=(s.tasks||[]).find(x=>x.id===id);if(!t)return;window.modal(`<div class="stage4-modal"><span class="eyebrow">დავალების დეტალები</span><h2>${esc(t.title)}</h2><p>${esc(t.category||'დავალება')} · ${esc(t.platform)} · ${esc(t.action)}</p><div class="stage4-detail-row"><span>ჯილდო</span><b>+${money(t.reward)} კრედიტი</b></div><div class="stage4-detail-row"><span>მოქმედება</span><b>${esc(t.action)}</b></div><div class="stage4-detail-row"><span>პლატფორმა</span><b>${esc(t.platform)}</b></div><a class="primary stage4-full-btn" href="${esc(t.target_url)}" target="_blank" rel="noopener noreferrer">დავალების გახსნა ↗</a></div>`)}

  function campaigns(){
    const list=q('#promotionList'),s=S();if(!list||!s?.user)return;qa('.promotion-row',list).forEach((row,i)=>{const p=s.promotions?.[i];if(!p)return;row.dataset.stage4PromotionId=p.id;const cost=Math.max(1,Number(p.cost||0)),remaining=Math.max(0,Number(p.remaining_budget??cost)),used=Math.min(cost,Math.max(0,cost-remaining)),pct=Math.round(used/cost*100);let meta=q('.stage4-campaign-meta',row);if(!meta){meta=document.createElement('div');meta.className='stage4-campaign-meta';row.appendChild(meta)}meta.innerHTML=`<div class="stage4-campaign-line"><span>${esc(statuses[p.status]||p.status||'აქტიური')}</span><b>${money(remaining)} / ${money(cost)} კრედიტი დარჩა</b></div><div class="stage4-progress"><i style="width:${pct}%"></i></div>`})
  }

  function wallet(){
    const list=q('#transactionsList'),s=S();if(!list||!s?.user)return;let filter=q('#stage4WalletSearch');
    if(!filter){filter=document.createElement('input');filter.id='stage4WalletSearch';filter.type='search';filter.className='stage4-wallet-search';filter.placeholder='🔍 მოძებნე ოპერაცია...';q('#wallet .transactions .section-head')?.appendChild(filter)}
    if(filter.dataset.bound!=='1'){filter.dataset.bound='1';filter.addEventListener('input',()=>{walletSearch=filter.value;walletRows()})}filter.value=walletSearch;walletRows();
  }
  function walletRows(){const list=q('#transactionsList'),s=S();if(!list||!s?.user)return;const term=walletSearch.trim().toLocaleLowerCase('ka-GE');const rows=(s.transactions||[]).filter(x=>!term||`${labels[x.type]||x.type} ${x.amount}`.toLocaleLowerCase('ka-GE').includes(term)).slice(0,50);list.innerHTML=rows.length?rows.map(x=>`<button type="button" class="stage4-tx"><span class="stage4-tx-icon ${Number(x.amount)>0?'positive':'negative'}">${Number(x.amount)>0?'↑':'↓'}</span><span><b>${esc(labels[x.type]||x.type||'ოპერაცია')}</b><small>${esc(new Date(x.created_at).toLocaleString('ka-GE'))}</small></span><strong>${Number(x.amount)>0?'+':''}${money(x.amount)}</strong></button>`).join(''):'<div class="empty">ამ ძიებით ოპერაცია ვერ მოიძებნა.</div>'}

  function profile(){const layout=q('#profile-settings .settings-layout'),s=S();if(!layout||!s?.user)return;let box=q('#stage4Security');if(!box){box=document.createElement('article');box.id='stage4Security';box.className='stage4-security';layout.insertAdjacentElement('afterend',box)}const verified=!!s.user.email_confirmed_at;box.innerHTML=`<div><span class="eyebrow">უსაფრთხოება</span><h3>ანგარიშის დაცვა</h3><p>კრედიტის ცვლილებები და კამპანიის ბიუჯეტი სერვერზე, დაცულ PostgreSQL RPC-ებში მუშავდება.</p></div><div class="stage4-security-list"><span class="${verified?'ok':'warn'}">${verified?'✓ ელფოსტა დადასტურებულია':'! ელფოსტა დასადასტურებელია'}</span><span class="ok">✓ საკუთარი კამპანიის დავალება დაცულია</span><span class="ok">✓ დუბლირებული შესრულება იბლოკება</span><span class="ok">✓ ბიუჯეტი ტრანზაქციაში იკეტება</span><span class="ok">✓ ადმინისტრაციული მოქმედებები audit-ში იწერება</span></div>`}

  function guards(){if(document.documentElement.dataset.stage4Guards==='1')return;document.documentElement.dataset.stage4Guards='1';document.addEventListener('click',e=>{const b=e.target.closest('button[data-task-id]');if(!b||b.disabled||b.dataset.stage4Busy==='1')return;b.dataset.stage4Busy='1';b.disabled=true;setTimeout(()=>{b.dataset.stage4Busy=''},9000)},true);document.addEventListener('click',e=>{const b=e.target.closest('[data-stage4-go]');if(!b)return;if(typeof window.showView==='function')window.showView(b.dataset.stage4Go)},true)}
  function init(){dashboard();tasks();campaigns();wallet();profile();guards();setInterval(()=>{dashboard();tasks();campaigns();wallet();profile()},2500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
