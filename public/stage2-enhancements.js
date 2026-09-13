(function(){
  'use strict';

  const q=s=>document.querySelector(s);
  const qa=s=>[...document.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
  const money=n=>Number(n||0).toLocaleString('ka-GE');
  const labels={
    task_reward:'დავალების ჯილდო',promotion_spend:'კამპანიის ხარჯი',promotion_refund:'კამპანიის თანხის დაბრუნება',
    opening_balance:'საწყისი ბალანსი',admin_adjustment:'ადმინისტრატორის კორექცია',signup_bonus:'საწყისი ბონუსი'
  };
  const actionLabels={Follow:'გამომყევი',Subscribe:'გამომიწერე',Like:'მოიწონე',Visit:'ეწვიე პროფილს'};
  let currentPage=1;
  const perPage=8;
  let lastTaskSignature='';
  let notificationChannel=null;

  function st(){try{return typeof state!=='undefined'?state:null}catch{return null}}
  function sb(){const s=st();return s&&s.supabase?s.supabase:null}
  function toast(t){try{if(typeof window.toast==='function')window.toast(t)}catch{}}
  function go(id){try{if(typeof window.showView==='function')window.showView(id);else{qa('.view').forEach(v=>v.classList.toggle('active-view',v.id===id));}}catch{}}

  function injectStyle(){
    if(q('#stage2-style'))return;
    const s=document.createElement('style');s.id='stage2-style';s.textContent=`
      .stage2-task-controls{display:grid;grid-template-columns:minmax(180px,1.7fr) repeat(3,minmax(120px,1fr));gap:10px;margin:14px 0 4px}
      .stage2-task-controls input,.stage2-task-controls select,.stage2-wallet-filter{width:100%;border:1px solid var(--line,#dfe4ec);background:var(--card,#fff);color:inherit;border-radius:12px;padding:11px 12px;font:inherit;outline:none}
      .stage2-task-controls input:focus,.stage2-task-controls select:focus,.stage2-wallet-filter:focus{border-color:#8aa4ff;box-shadow:0 0 0 3px rgba(80,110,240,.1)}
      .stage2-pagination{display:flex;justify-content:center;align-items:center;gap:8px;margin:18px 0 4px;flex-wrap:wrap}
      .stage2-pagination button{border:1px solid var(--line,#dfe4ec);background:var(--card,#fff);color:inherit;border-radius:10px;padding:8px 12px;cursor:pointer}
      .stage2-pagination button.active{font-weight:700;border-color:#7188ff;background:rgba(113,136,255,.12)}
      .stage2-pagination button:disabled{opacity:.45;cursor:not-allowed}
      .stage2-count{font-size:12px;opacity:.65;margin:8px 0;text-align:center}
      .stage2-notify-panel{position:absolute;right:0;top:48px;width:min(360px,calc(100vw - 28px));background:var(--card,#fff);border:1px solid var(--line,#dfe4ec);border-radius:16px;box-shadow:0 18px 50px rgba(20,30,50,.16);padding:10px;z-index:1000;max-height:430px;overflow:auto}
      .stage2-notify-wrap{position:relative}
      .stage2-notify-head{display:flex;justify-content:space-between;align-items:center;padding:7px 8px 10px;font-weight:800}
      .stage2-notify-head button{border:0;background:none;color:inherit;cursor:pointer;font-size:12px;opacity:.7}
      .stage2-notification{display:flex;gap:10px;padding:12px 9px;border-radius:12px;cursor:pointer}
      .stage2-notification:hover{background:rgba(120,130,150,.08)}
      .stage2-notification.unread{background:rgba(90,115,255,.08)}
      .stage2-notification b{display:block;font-size:13px}.stage2-notification small{display:block;opacity:.68;margin-top:3px;line-height:1.35}
      .stage2-dot{width:7px;height:7px;border-radius:50%;background:#687dff;flex:0 0 auto;margin-top:6px}
      .stage2-wallet-head{display:flex;gap:12px;align-items:stretch;flex-wrap:wrap;margin-bottom:14px}
      .stage2-balance-card{flex:1;min-width:210px;border-radius:16px;padding:18px;background:linear-gradient(135deg,#101828,#26324b);color:#fff}
      .stage2-balance-card small{opacity:.7}.stage2-balance-card strong{display:block;font-size:28px;margin-top:5px}
      .stage2-wallet-filter{max-width:240px;align-self:center}
      .stage2-analytics-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
      .stage2-analytics-card{border:1px solid var(--line,#dfe4ec);border-radius:16px;padding:16px;background:var(--card,#fff)}
      .stage2-analytics-card small{opacity:.65}.stage2-analytics-card strong{display:block;font-size:22px;margin-top:5px}
      .stage2-campaign-list{display:grid;gap:9px;margin-top:12px}.stage2-campaign-row{display:grid;grid-template-columns:1fr auto;gap:12px;border:1px solid var(--line,#dfe4ec);border-radius:13px;padding:12px}.stage2-campaign-row small{display:block;opacity:.65;margin-top:4px}
      .stage2-skeleton{display:grid;gap:10px}.stage2-skeleton div{height:78px;border-radius:14px;background:linear-gradient(90deg,rgba(130,140,160,.12),rgba(130,140,160,.22),rgba(130,140,160,.12));background-size:200% 100%;animation:stage2sh 1.1s linear infinite}
      @keyframes stage2sh{to{background-position:-200% 0}}
      .stage2-bottom-nav{display:none}
      @media(max-width:760px){
        .stage2-task-controls{grid-template-columns:1fr 1fr}.stage2-task-controls input{grid-column:1/-1}
        .stage2-analytics-grid{grid-template-columns:1fr 1fr}.stage2-wallet-filter{max-width:none;flex:1}
        .stage2-bottom-nav{position:fixed;display:grid;grid-template-columns:repeat(5,1fr);left:10px;right:10px;bottom:10px;z-index:900;background:rgba(255,255,255,.94);border:1px solid #e1e5ec;border-radius:18px;box-shadow:0 14px 38px rgba(20,30,50,.18);padding:7px;backdrop-filter:blur(12px)}
        body.dark .stage2-bottom-nav{background:rgba(20,25,34,.94);border-color:#313846}.stage2-bottom-nav button{border:0;background:none;color:inherit;padding:7px 2px;border-radius:11px;font:inherit;font-size:10px;display:grid;gap:2px;justify-items:center}.stage2-bottom-nav button span{font-size:18px}.stage2-bottom-nav button.active{background:rgba(100,120,255,.12);font-weight:700}
        .main{padding-bottom:82px}
      }
      @media(min-width:761px){.stage2-bottom-nav{display:none!important}}
    `;document.head.appendChild(s);
  }

  function addSkeleton(){
    const e=q('#allTasks');if(e&&!e.dataset.stage2Skeleton){e.dataset.stage2Skeleton='1';e.innerHTML='<div class="stage2-skeleton"><div></div><div></div><div></div></div>'}
  }

  function taskControls(){
    const host=q('#tasks');if(!host||q('#stage2TaskControls'))return;
    const toolbar=host.querySelector('.toolbar');if(!toolbar)return;
    const box=document.createElement('div');box.id='stage2TaskControls';box.className='stage2-task-controls';
    box.innerHTML='<input id="stage2TaskSearch" type="search" placeholder="🔍 მოძებნე დავალება..." autocomplete="off"><select id="stage2TaskAction"><option value="all">ყველა მოქმედება</option><option value="Follow">გამომყევი</option><option value="Subscribe">გამომიწერე</option><option value="Like">მოიწონე</option><option value="Visit">ეწვიე</option></select><select id="stage2TaskReward"><option value="all">ყველა ჯილდო</option><option value="10">10+ კრედიტი</option><option value="20">20+ კრედიტი</option><option value="50">50+ კრედიტი</option></select><select id="stage2TaskSort"><option value="default">ნაგულისხმევი</option><option value="reward">ჯილდო: მაღალი</option><option value="newest">უახლესი</option></select>';
    toolbar.after(box);
    ['#stage2TaskSearch','#stage2TaskAction','#stage2TaskReward','#stage2TaskSort'].forEach(id=>q(id).addEventListener('input',()=>{currentPage=1;renderStage2Tasks()}));
  }

  function filteredTasks(){
    const s=st();let a=[...(s?.tasks||[])];
    const search=(q('#stage2TaskSearch')?.value||'').trim().toLocaleLowerCase('ka-GE');
    const action=q('#stage2TaskAction')?.value||'all', reward=q('#stage2TaskReward')?.value||'all', sort=q('#stage2TaskSort')?.value||'default';
    if(s?.filter&&s.filter!=='all')a=a.filter(t=>t.platform===s.filter);
    if(search)a=a.filter(t=>[t.title,t.platform,t.category,t.action].some(v=>String(v??'').toLocaleLowerCase('ka-GE').includes(search)));
    if(action!=='all')a=a.filter(t=>t.action===action);
    if(reward!=='all')a=a.filter(t=>Number(t.reward||0)>=Number(reward));
    if(sort==='reward')a.sort((x,y)=>Number(y.reward||0)-Number(x.reward||0));
    if(sort==='newest')a.sort((x,y)=>new Date(y.created_at)-new Date(x.created_at));
    return a;
  }

  function renderStage2Tasks(){
    const s=st(),e=q('#allTasks');if(!s||!e)return;
    const a=filteredTasks(),pages=Math.max(1,Math.ceil(a.length/perPage));currentPage=Math.min(currentPage,pages);
    const slice=a.slice((currentPage-1)*perPage,currentPage*perPage);
    if(typeof window.taskCard==='function')e.innerHTML=slice.length?slice.map(window.taskCard).join(''):'<div class="empty">ამ ფილტრებით დავალება ვერ მოიძებნა.</div>';
    else e.innerHTML=slice.length?slice.map(t=>`<article class="task-card"><strong>${esc(t.title)}</strong><small>${esc(t.platform)} · +${money(t.reward)}</small></article>`).join(''):'<div class="empty">ამ ფილტრებით დავალება ვერ მოიძებნა.</div>';
    let p=q('#stage2Pagination');if(!p){p=document.createElement('div');p.id='stage2Pagination';p.className='stage2-pagination';e.after(p)}
    p.innerHTML='';
    const prev=document.createElement('button');prev.textContent='‹';prev.disabled=currentPage===1;prev.onclick=()=>{currentPage--;renderStage2Tasks()};p.appendChild(prev);
    for(let i=1;i<=pages;i++){if(pages>7&&Math.abs(i-currentPage)>2&&i!==1&&i!==pages)continue;const b=document.createElement('button');b.textContent=i;b.className=i===currentPage?'active':'';b.onclick=()=>{currentPage=i;renderStage2Tasks()};p.appendChild(b)}
    const next=document.createElement('button');next.textContent='›';next.disabled=currentPage===pages;next.onclick=()=>{currentPage++;renderStage2Tasks()};p.appendChild(next);
    let c=q('#stage2TaskCount');if(!c){c=document.createElement('div');c.id='stage2TaskCount';c.className='stage2-count';p.after(c)}c.textContent=a.length?`${(currentPage-1)*perPage+1}–${Math.min(currentPage*perPage,a.length)} / ${a.length} დავალება`:'0 დავალება';
    const sig=a.map(x=>x.id+':'+x.reward).join('|')+'|'+currentPage;
    if(sig!==lastTaskSignature){lastTaskSignature=sig;}
  }

  function enhanceWallet(){
    const host=q('#wallet');if(!host)return;
    let head=q('#stage2WalletHead');if(!head){head=document.createElement('div');head.id='stage2WalletHead';head.className='stage2-wallet-head';const panel=host.querySelector('.panel')||host.firstElementChild; if(panel)panel.prepend(head);}
    const s=st();const bal=s?.profile?.credits||0;
    head.innerHTML=`<div class="stage2-balance-card"><small>მიმდინარე ბალანსი</small><strong>${money(bal)} კრედიტი</strong><small>განახლდება ავტომატურად</small></div><input id="stage2WalletFilter" class="stage2-wallet-filter" type="search" placeholder="🔍 მოძებნე ოპერაცია...">`;
    const list=q('#transactionsList');if(!list)return;const term=(q('#stage2WalletFilter')?.value||'').trim().toLocaleLowerCase('ka-GE');
    const rows=(s?.transactions||[]).filter(x=>!term||`${labels[x.type]||x.type} ${x.amount}`.toLocaleLowerCase('ka-GE').includes(term)).slice(0,50);
    list.innerHTML=rows.length?rows.map(x=>{const amount=Number(x.amount||0),positive=amount>0;return `<div class="transaction"><span class="tx-icon ${positive?'tx-positive':'tx-negative'}">${positive?'↑':'↓'}</span><div><b>${esc(labels[x.type]||x.type)}</b><small>${new Date(x.created_at).toLocaleString('ka-GE')}</small></div><strong class="${positive?'positive':'negative'}">${positive?'+':''}${money(amount)}</strong></div>`}).join(''):'<div class="empty">ოპერაციები ვერ მოიძებნა.</div>';
    q('#stage2WalletFilter').oninput=enhanceWallet;
  }

  function enhanceAnalytics(){
    const host=q('#analytics');if(!host)return;
    let box=q('#stage2Analytics');if(!box){box=document.createElement('div');box.id='stage2Analytics';box.className='stage2-analytics-grid';const anchor=host.querySelector('.panel:last-child')||host.lastElementChild;if(anchor)anchor.after(box);else host.appendChild(box)}
    const s=st();const tr=s?.transactions||[],pr=s?.promotions||[];
    const spent=tr.filter(x=>x.type==='promotion_spend').reduce((a,x)=>a+Math.abs(Number(x.amount)||0),0);
    const refunds=tr.filter(x=>x.type==='promotion_refund').reduce((a,x)=>a+Number(x.amount||0),0);
    const earned=tr.filter(x=>x.type==='task_reward').reduce((a,x)=>a+Number(x.amount||0),0);
    const active=pr.filter(x=>x.status==='active').length;
    box.innerHTML=[['დახარჯული',spent],['დაბრუნებული',refunds],['დავალებებიდან მიღებული',earned],['აქტიური კამპანიები',active]].map(x=>`<article class="stage2-analytics-card"><small>${x[0]}</small><strong>${money(x[1])}${typeof x[1]==='number'&&x[0]!=='აქტიური კამპანიები'?' კრედიტი':''}</strong></article>`).join('');
    let list=q('#stage2CampaignList');if(!list){list=document.createElement('div');list.id='stage2CampaignList';list.className='stage2-campaign-list';box.after(list)}
    list.innerHTML=pr.length?pr.slice(0,12).map(p=>{const related=tr.filter(x=>x.promotion_id===p.id);const spend=related.filter(x=>x.type==='promotion_spend').reduce((a,x)=>a+Math.abs(Number(x.amount)||0),0);return `<div class="stage2-campaign-row"><div><b>${esc(p.title||'კამპანია')}</b><small>${esc(p.platform||'')} · ${esc(p.status||'')}</small></div><strong>${money(spend)} დახარჯული</strong></div>`}).join(''):'<div class="empty">კამპანიები ჯერ არ გაქვს.</div>';
  }

  async function loadNotifications(){
    const s=st(),client=sb();if(!s||!client||!s.user)return;
    try{
      const r=await client.from('notifications').select('id,type,title,body,read_at,created_at').eq('user_id',s.user.id).order('created_at',{ascending:false}).limit(30);
      if(r.error)throw r.error;renderNotifications(r.data||[]);
    }catch(e){
      if(String(e.message||e).toLowerCase().includes('notifications'))return;
      console.error('notifications',e);
    }
  }

  function renderNotifications(rows){
    const btn=q('#notifyBtn');if(!btn)return;let wrap=q('#stage2NotifyWrap');
    if(!wrap){wrap=document.createElement('div');wrap.id='stage2NotifyWrap';wrap.className='stage2-notify-wrap';btn.parentElement.appendChild(wrap);wrap.appendChild(btn)}
    const unread=rows.filter(x=>!x.read_at).length;btn.innerHTML=`♢<i></i>`;btn.setAttribute('aria-label',`შეტყობინებები${unread?' '+unread:''}`);if(unread)btn.classList.add('has-unread');else btn.classList.remove('has-unread');
    let panel=q('#stage2NotifyPanel');if(!panel){panel=document.createElement('div');panel.id='stage2NotifyPanel';panel.className='stage2-notify-panel';panel.hidden=true;wrap.appendChild(panel)}
    panel.innerHTML=`<div class="stage2-notify-head"><span>შეტყობინებები${unread?' · '+unread:''}</span><button id="stage2MarkAll">ყველას წაკითხვად</button></div>${rows.length?rows.map(x=>`<div class="stage2-notification ${x.read_at?'':'unread'}" data-notification-id="${esc(x.id)}"><span class="stage2-dot"></span><div><b>${esc(x.title)}</b><small>${esc(x.body)} · ${new Date(x.created_at).toLocaleString('ka-GE')}</small></div></div>`).join(''):'<div class="empty">შეტყობინება ჯერ არ არის.</div>'}`;
    btn.onclick=e=>{e.stopPropagation();panel.hidden=!panel.hidden};
    panel.querySelector('#stage2MarkAll').onclick=async e=>{e.stopPropagation();const client=sb(),s=st();if(!client||!s?.user)return;await client.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',s.user.id).is('read_at',null);await loadNotifications()};
    panel.querySelectorAll('[data-notification-id]').forEach(n=>n.onclick=async()=>{const client=sb(),s=st();if(!client||!s?.user)return;await client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',n.dataset.notificationId).eq('user_id',s.user.id);n.classList.remove('unread');await loadNotifications()});
  }

  function notifications(){
    const s=st(),client=sb();if(!s||!client||!s.user)return;
    loadNotifications();
    try{
      notificationChannel=client.channel('exchange-notifications-'+s.user.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+s.user.id},payload=>{loadNotifications();toast(payload.new?.title||'ახალი შეტყობინება')}).subscribe();
    }catch(e){console.error('realtime notifications',e)}
  }

  function bottomNav(){
    if(q('#stage2BottomNav'))return;const n=document.createElement('nav');n.id='stage2BottomNav';n.className='stage2-bottom-nav';
    [['dashboard','⌂','მთავარი'],['tasks','✓','დავალებები'],['promotions','↗','კამპანია'],['wallet','◈','კრედიტები'],['profile-settings','◎','პროფილი']].forEach(x=>{const b=document.createElement('button');b.dataset.view=x[0];b.innerHTML=`<span>${x[1]}</span>${x[2]}`;b.onclick=()=>go(x[0]);n.appendChild(b)});document.body.appendChild(n);
    setInterval(()=>{const s=st(),user=!!s?.user;qa('#stage2BottomNav button').forEach(b=>b.style.display=(!user&&b.dataset.view!=='dashboard'&&b.dataset.view!=='tasks')?'none':'grid')},1000);
  }

  function boot(){
    injectStyle();addSkeleton();bottomNav();taskControls();
    setTimeout(()=>{renderStage2Tasks();enhanceWallet();enhanceAnalytics();notifications()},900);
    setInterval(()=>{
      const s=st();if(!s?.supabase)return;
      taskControls();renderStage2Tasks();enhanceWallet();enhanceAnalytics();
      const sig=(s.user?.id||'')+'|'+(s.transactions?.length||0)+'|'+(s.promotions?.length||0);if(sig!==boot.lastSig){boot.lastSig=sig;notifications()}
    },1800);
    document.addEventListener('click',e=>{const p=q('#stage2NotifyPanel'),wrap=q('#stage2NotifyWrap');if(p&&wrap&&!wrap.contains(e.target))p.hidden=true});
  }
  boot();
})();
