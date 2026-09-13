(() => {
  const q = (s, root = document) => root?.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  const style = document.createElement('style');
  style.textContent = `
    .profile-user-card{margin-top:18px;padding:18px;border:1px solid rgba(190,205,235,.24);border-radius:18px;background:#111b2d;color:#f7f9ff}
    .profile-user-name{font-size:22px;font-weight:800;line-height:1.25;color:#fff}
    .profile-user-email{margin-top:5px;font-size:14px;line-height:1.4;color:#aebbd0;word-break:break-word}
    .profile-user-status{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:7px 10px;border:1px solid rgba(190,205,235,.28);border-radius:10px;color:#eef2ff;font-size:12px;font-weight:800;background:rgba(255,255,255,.04)}
    .profile-user-status::before{content:"";width:7px;height:7px;border-radius:50%;background:#72d7a5}
    .profile-edit-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding:14px 0 0;border-top:1px solid rgba(190,205,235,.2)}
    .profile-edit-row p{margin:0;color:#aebbd0;font-size:12px;line-height:1.5}
    .profile-edit-toggle{border:1px solid rgba(190,205,235,.3);background:#18243a;color:#eef2ff;border-radius:11px;padding:10px 14px;display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:12px;white-space:nowrap}
    .profile-edit-toggle:hover{background:#22314d;border-color:rgba(190,205,235,.5)}
    .profile-edit-form{overflow:hidden;transition:max-height .25s ease,opacity .2s ease,margin-top .25s ease}
    .profile-edit-form.is-closed{max-height:0!important;opacity:0!important;margin-top:0!important}
    .profile-edit-form.is-open{max-height:1000px;opacity:1}
    .profile-extra{margin-top:14px;display:grid;gap:14px}
    .profile-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .profile-stat{padding:16px;border:1px solid rgba(190,205,235,.24);border-radius:16px;background:#111b2d;color:#f7f9ff}
    .profile-stat small{display:block;color:#aebbd0;font-size:12px;margin-bottom:7px}.profile-stat strong{display:block;color:#fff;font-size:22px}
    .profile-section{background:#111b2d;border:1px solid rgba(190,205,235,.24);border-radius:19px;padding:18px;color:#fff}
    .profile-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.profile-section-head h3{margin:0;color:#fff;font-size:18px}.profile-section-head small{color:#aebbd0;font-size:12px}
    .profile-social-list,.profile-activity{display:grid;gap:8px}
    .profile-social-item{display:flex;align-items:center;gap:11px;padding:11px;border-radius:13px;background:#18243a;border:1px solid rgba(190,205,235,.2)}
    .profile-social-icon{width:38px;height:38px;border-radius:11px;background:#202f4a;color:#dfe6ff;display:grid;place-items:center;font-weight:900}
    .profile-social-info{min-width:0;flex:1}.profile-social-info strong{display:block;color:#fff;font-size:13px}.profile-social-info small{display:block;color:#aebbd0;font-size:11px;margin-top:3px}.profile-social-item a{color:#cfd8ff;text-decoration:none;font-size:12px;font-weight:800}
    .profile-activity-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(190,205,235,.16)}.profile-activity-item:last-child{border-bottom:0}.profile-activity-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:#203d35;color:#9de3c0;font-weight:900}.profile-activity-item div:nth-child(2){min-width:0;flex:1}.profile-activity-item strong{display:block;color:#fff;font-size:12px}.profile-activity-item small{display:block;color:#aebbd0;font-size:10px;margin-top:2px}.profile-activity-value{color:#fff;font-weight:900;font-size:12px}
    .profile-account-actions-bottom{margin-top:14px;width:100%;background:#111b2d!important;border:1px solid rgba(190,205,235,.24)!important;border-radius:19px!important;color:#fff}
    .profile-account-actions-bottom h3,.profile-account-actions-bottom h2{color:#fff}.profile-account-actions-bottom p,.profile-account-actions-bottom small{color:#aebbd0}
    .profile-account-actions-bottom input,.profile-account-actions-bottom select{background:#18243a;color:#fff;border-color:rgba(190,205,235,.25)}
    .profile-account-actions-bottom .danger-btn{margin-top:8px}
    @media(max-width:800px){.profile-user-card{padding:17px}.profile-user-name{font-size:21px}.profile-user-email{font-size:14px}.profile-edit-row{align-items:flex-start;flex-direction:column}.profile-edit-toggle{width:100%;justify-content:center}.profile-section{padding:15px}.profile-stat strong{font-size:20px}}
  `;
  document.head.appendChild(style);

  const previewPlatform = q('#previewPlatform');
  if (previewPlatform && !q('#previewAction')) {
    const previewAction = document.createElement('span');
    previewAction.id = 'previewAction';
    previewAction.hidden = true;
    previewPlatform.parentElement.appendChild(previewAction);
  }

  function getState(){try{return typeof state!=='undefined'?state:null}catch{return null}}

  function getProfileCard(){
    const settings=q('#profile-settings');
    if(!settings)return null;
    return [...settings.querySelectorAll('.settings-card')].find(c=>c.querySelector('#settingsAvatar'))||settings.querySelector('.settings-card');
  }

  function setupIdentity(){
    const settings=q('#profile-settings'),card=getProfileCard(),avatar=q('#settingsAvatar'),s=getState();
    if(!settings||!card||!avatar||!s?.user)return;
    const p=s.profile||{};
    const name=p.display_name||p.username||s.user.email?.split('@')[0]||'მომხმარებელი';
    const email=s.user.email||'';
    const role=p.role==='admin'?'ადმინისტრატორი':'მომხმარებელი';

    let userCard=q('.profile-user-card',card);
    if(!userCard){userCard=document.createElement('div');userCard.className='profile-user-card';avatar.insertAdjacentElement('afterend',userCard)}
    userCard.innerHTML=`<div class="profile-user-name">${esc(name)}</div><div class="profile-user-email">${esc(email)}</div><div class="profile-user-status">${esc(role)}</div>`;

    [...card.children].forEach(el=>{
      if(el===avatar||el===userCard||el===q('.profile-edit-row',card)||el===q('#profileSettingsForm',card))return;
      const txt=(el.textContent||'').trim();
      if(/პირადი ინფორმაცია|მომხმარებლის სახელი|ანგარიშის ძირითადი ინფორმაცია/.test(txt))el.remove();
    });
  }

  function setupEditor(){
    const form=q('#profileSettingsForm');if(!form)return;
    const card=form.closest('.settings-card');if(!card)return;
    form.classList.add('profile-edit-form');
    if(!form.dataset.profileEditState){form.dataset.profileEditState='closed';form.classList.add('is-closed');form.style.maxHeight='0px';form.style.opacity='0';form.style.marginTop='0'}
    let row=q('.profile-edit-row',card);
    if(!row){row=document.createElement('div');row.className='profile-edit-row';row.innerHTML='<p>ანგარიშის ინფორმაციის შეცვლა</p><button type="button" class="profile-edit-toggle" aria-expanded="false"><span>✎</span><span>რედაქტირება</span></button>';const userCard=q('.profile-user-card',card);(userCard||card).insertAdjacentElement('afterend',row)}
    const toggle=q('.profile-edit-toggle',row);
    if(toggle&&!toggle.dataset.bound){
      toggle.dataset.bound='1';
      toggle.addEventListener('click',()=>{
        const open=form.dataset.profileEditState!=='open';
        form.dataset.profileEditState=open?'open':'closed';form.classList.toggle('is-open',open);form.classList.toggle('is-closed',!open);form.style.maxHeight=open?`${form.scrollHeight+40}px`:'0px';form.style.opacity=open?'1':'0';form.style.marginTop=open?'14px':'0';toggle.setAttribute('aria-expanded',String(open));toggle.querySelector('span:last-child').textContent=open?'დახურვა':'რედაქტირება';
      });
    }
  }

  function getActionsCard(){
    const settings=q('#profile-settings');if(!settings)return null;
    return [...settings.querySelectorAll('.settings-card')].find(c=>{const text=(c.textContent||'').replace(/\s+/g,' ');return text.includes('ანგარიშის მოქმედებები')||!!c.querySelector('.danger-btn')})||null;
  }

  function renderExtra(){
    const settings=q('#profile-settings'),layout=q('#profile-settings .settings-layout'),s=getState();
    if(!settings||!layout||!s?.user)return;
    let extra=q('#profileExtra');
    if(!extra){extra=document.createElement('div');extra.id='profileExtra';extra.className='profile-extra';layout.insertAdjacentElement('afterend',extra)}
    const text=(sel,def='0')=>q(sel)?.textContent||def;
    const profiles=[...document.querySelectorAll('#profileGrid .profile-card')];
    const socials=profiles.length?profiles.map(c=>{const a=c.querySelector('a');return `<div class="profile-social-item"><span class="profile-social-icon">${esc(c.querySelector('.platform-icon')?.textContent||'◎')}</span><div class="profile-social-info"><strong>${esc(c.querySelector('.info strong')?.textContent||'პროფილი')}</strong><small>${esc(c.querySelector('.info small')?.textContent||'')}</small></div>${a?`<a href="${esc(a.href)}" target="_blank" rel="noopener">გახსნა ↗</a>`:''}</div>`}).join(''):'<div class="empty">სოციალური პროფილები ჯერ არ დაგიმატებია.</div>';
    const tx=[...document.querySelectorAll('#transactionsList .transaction')].slice(0,5);
    const activity=tx.length?tx.map(r=>`<div class="profile-activity-item"><span class="profile-activity-icon">${esc(r.querySelector('.tx-icon')?.textContent||'↗')}</span><div><strong>${esc(r.querySelector('b')?.textContent||'ოპერაცია')}</strong><small>${esc(r.querySelector('small')?.textContent||'')}</small></div><span class="profile-activity-value">${esc(r.querySelector('strong')?.textContent||'')}</span></div>`).join(''):'<div class="empty">ბოლო აქტივობა ჯერ არ არის.</div>';
    extra.innerHTML=`<div class="profile-stat-grid"><article class="profile-stat"><small>კრედიტები</small><strong>${esc(text('#credits'))}</strong></article><article class="profile-stat"><small>შესრულებული</small><strong>${esc(text('#completedCount'))}</strong></article><article class="profile-stat"><small>დაგროვილი</small><strong>${esc(text('#earnedCount'))}</strong></article><article class="profile-stat"><small>აქტიური კამპანიები</small><strong>${esc(text('#analyticsCampaigns'))}</strong></article></div><article class="profile-section"><div class="profile-section-head"><div><h3>სოციალური პროფილები</h3><small>${esc(text('#profileCount'))} დაკავშირებული პროფილი</small></div><button class="link-btn" data-view-target="profiles">მართვა →</button></div><div class="profile-social-list">${socials}</div></article><article class="profile-section"><div class="profile-section-head"><div><h3>ბოლო აქტივობა</h3><small>კრედიტის ოპერაციები</small></div><button class="link-btn" data-view-target="wallet">ყველას ნახვა →</button></div><div class="profile-activity">${activity}</div></article>`;

    const actions=getActionsCard();
    if(actions){actions.classList.add('profile-account-actions-bottom');if(actions.parentElement!==settings||actions.previousElementSibling!==extra)extra.insertAdjacentElement('afterend',actions)}
  }

  function gateUnauthenticated(){
    const s=getState(),settings=q('#profile-settings'),nav=[...document.querySelectorAll('[data-view="profile-settings"]')];
    if(!s?.user){
      nav.forEach(x=>x.hidden=true);
      if(settings?.classList.contains('active-view')){
        if(typeof showView==='function')showView('dashboard');else settings.classList.remove('active-view');
      }
      return;
    }
    nav.forEach(x=>x.hidden=false);
  }

  function render(){
    gateUnauthenticated();
    const s=getState();if(!s?.user)return;
    setupIdentity();setupEditor();renderExtra();
  }

  document.addEventListener('DOMContentLoaded',render);
  setInterval(render,1000);
})();
