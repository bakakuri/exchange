(function(){
  'use strict';

  const q=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const stateRef=()=>{try{return typeof state!=='undefined'?state:null}catch{return null}};
  let panel=null;
  let channel=null;
  let lastUserId=null;
  let poll=null;

  const typeNames={
    credit:'კრედიტები',promotion:'კამპანია',system:'სისტემა',task:'დავალება',security:'უსაფრთხოება'
  };

  function sb(){return stateRef()?.supabase||null}
  function user(){return stateRef()?.user||null}
  function notifyButton(){return q('#notifyBtn')}
  function formatDate(v){try{return new Date(v).toLocaleString('ka-GE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}catch{return ''}}

  function ensureBell(){
    const top=q('.top-actions');
    if(!top)return;
    let b=notifyButton();
    if(!b){
      b=document.createElement('button');
      b.id='notifyBtn';b.className='icon-btn notification';b.title='შეტყობინებები';b.setAttribute('aria-label','შეტყობინებები');b.type='button';b.textContent='♢';
      top.insertBefore(b,q('#topAvatar')||null);
    }
    b.setAttribute('aria-expanded','false');
    b.addEventListener('click',async e=>{e.stopPropagation();await togglePanel()},{capture:true});
  }

  function closePanel(){if(panel){panel.remove();panel=null;const b=notifyButton();if(b)b.setAttribute('aria-expanded','false')}}

  async function loadNotifications(){
    const s=sb(),u=user();
    if(!s||!u)return [];
    const r=await s.from('notifications').select('id,type,title,body,read_at,created_at').eq('user_id',u.id).order('created_at',{ascending:false}).limit(40);
    if(r.error){
      console.warn('Notifications unavailable:',r.error.message);
      return [];
    }
    return r.data||[];
  }

  async function unreadCount(){
    const s=sb(),u=user();
    if(!s||!u)return 0;
    const r=await s.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',u.id).is('read_at',null);
    return r.error?0:(r.count||0);
  }

  function setBadge(n){
    const b=notifyButton();if(!b)return;
    b.classList.toggle('has-unread',n>0);
    let c=b.querySelector('.notification-count');
    if(n>0){if(!c){c=document.createElement('span');c.className='notification-count';b.appendChild(c)}c.textContent=n>99?'99+':String(n)}
    else if(c)c.remove();
  }

  function renderPanel(items){
    if(panel)panel.remove();
    panel=document.createElement('div');panel.className='ui-notification-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','შეტყობინებები');
    const unread=items.filter(x=>!x.read_at).length;
    panel.innerHTML=`<div class="ui-notification-head"><strong>შეტყობინებები</strong><button type="button" data-ui-read-all ${unread?'':'disabled'}>ყველას წაკითხვად მონიშვნა</button></div>`;
    if(!user()){
      panel.insertAdjacentHTML('beforeend','<div class="ui-notification-empty"><strong>შესვლა საჭიროა</strong>შეტყობინებების სანახავად შედი ანგარიშში.</div>');
    }else if(!items.length){
      panel.insertAdjacentHTML('beforeend','<div class="ui-notification-empty"><strong>ჯერ შეტყობინებები არ გაქვს</strong>აქ გამოჩნდება კრედიტების, კამპანიებისა და სისტემის მნიშვნელოვანი ცვლილებები.</div>');
    }else{
      const html=items.map(x=>`<article class="ui-notification-item ${x.read_at?'read':'unread'}" data-ui-notification="${esc(x.id)}"><span class="ui-notification-mark"></span><div><b>${esc(x.title||typeNames[x.type]||'შეტყობინება')}</b><p>${esc(x.body||'')}</p><time>${formatDate(x.created_at)}</time></div></article>`).join('');
      panel.insertAdjacentHTML('beforeend',html);
    }
    document.body.appendChild(panel);
    panel.querySelector('[data-ui-read-all]')?.addEventListener('click',markAllRead);
    panel.querySelectorAll('[data-ui-notification]').forEach(el=>el.addEventListener('click',()=>markRead(el.dataset.uiNotification)));
  }

  async function togglePanel(){
    if(panel){closePanel();return}
    const b=notifyButton();if(b)b.setAttribute('aria-expanded','true');
    renderPanel([]);
    if(panel)panel.innerHTML='<div class="ui-notification-empty">იტვირთება…</div>';
    const items=await loadNotifications();
    renderPanel(items);
    setBadge(items.filter(x=>!x.read_at).length);
  }

  async function markRead(id){
    const s=sb(),u=user();if(!s||!u)return;
    const r=await s.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('user_id',u.id);
    if(r.error)return;
    const items=await loadNotifications();renderPanel(items);setBadge(items.filter(x=>!x.read_at).length);
  }

  async function markAllRead(){
    const s=sb(),u=user();if(!s||!u)return;
    const r=await s.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',u.id).is('read_at',null);
    if(r.error)return;
    const items=await loadNotifications();renderPanel(items);setBadge(0);
  }

  async function refreshBadge(){
    if(!user()){setBadge(0);return}
    setBadge(await unreadCount());
  }

  function setupRealtime(){
    const s=sb(),u=user();
    if(!s||!u||channel)return;
    try{
      channel=s.channel('exchange-ui-notifications-'+u.id)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+u.id},payload=>{
          refreshBadge();
          if(panel)togglePanel();
        })
        .subscribe();
    }catch(e){console.warn('Notification realtime unavailable:',e)}
  }

  function resetRealtime(){
    try{if(channel&&sb())sb().removeChannel(channel)}catch{}
    channel=null;lastUserId=user()?.id||null;setupRealtime();refreshBadge();
  }

  function setupTheme(){
    const saved=localStorage.getItem('exchange-theme');
    if(saved==='dark')document.body.classList.add('dark');
    else if(saved==='light')document.body.classList.remove('dark');
    const buttons=[q('#themeBtn'),q('#themeTop')].filter(Boolean);
    const sync=()=>{const dark=document.body.classList.contains('dark');buttons.forEach(b=>{b.textContent=dark?'☀':'☾';b.title=dark?'ღია თემა':'მუქი თემა';b.setAttribute('aria-label',b.title)});document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0c1320':'#f5f7fb')};
    buttons.forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();document.body.classList.toggle('dark');localStorage.setItem('exchange-theme',document.body.classList.contains('dark')?'dark':'light');sync()},{capture:true}));
    sync();
  }

  function closeOutside(e){if(panel&&!panel.contains(e.target)&&!notifyButton()?.contains(e.target))closePanel()}

  function init(){
    ensureBell();setupTheme();document.addEventListener('click',closeOutside);
    poll=setInterval(()=>{
      const id=user()?.id||null;
      if(id!==lastUserId){resetRealtime();}
      else if(id)refreshBadge();
    },5000);
    resetRealtime();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
