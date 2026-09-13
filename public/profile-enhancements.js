(() => {
  const q = (s, root = document) => root.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  const style = document.createElement('style');
  style.textContent = `
    .profile-extra{margin-top:14px;display:grid;gap:14px}
    .profile-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .profile-stat{padding:15px;border:1px solid rgba(220,229,245,.22);border-radius:16px;background:#111b2d;box-shadow:0 8px 24px rgba(0,0,0,.14)}
    .profile-stat small{display:block;color:#aebbd0;font-size:12px;margin-bottom:6px}.profile-stat strong{display:block;color:#f5f7ff;font:700 22px "Space Grotesk",sans-serif}
    .profile-section{background:#111b2d;border:1px solid rgba(220,229,245,.22);border-radius:19px;padding:18px;box-shadow:0 8px 24px rgba(0,0,0,.14)}
    .profile-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.profile-section-head h3{margin:0;color:#f5f7ff;font-size:18px}.profile-section-head small{color:#aebbd0;font-size:12px}
    .profile-social-list,.profile-activity{display:grid;gap:8px}.profile-social-item{display:flex;align-items:center;gap:11px;padding:11px;border-radius:13px;background:#0c1525;border:1px solid rgba(220,229,245,.18)}
    .profile-social-icon{width:38px;height:38px;border-radius:11px;background:#17233a;color:#dce4ff;display:grid;place-items:center;font-weight:900;border:1px solid rgba(220,229,245,.2)}
    .profile-social-info{min-width:0;flex:1}.profile-social-info strong{display:block;color:#f5f7ff;font-size:13px}.profile-social-info small{display:block;color:#aebbd0;font-size:11px;margin-top:3px}.profile-social-item a{color:#dce4ff;text-decoration:none;font-size:12px;font-weight:800}
    .profile-activity-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(220,229,245,.14)}.profile-activity-item:last-child{border-bottom:0}.profile-activity-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:#17233a;color:#dce4ff;font-weight:900;border:1px solid rgba(220,229,245,.18)}.profile-activity-item div:nth-child(2){min-width:0;flex:1}.profile-activity-item strong{display:block;color:#f5f7ff;font-size:12px}.profile-activity-item small{display:block;color:#9eabc0;font-size:10px;margin-top:2px}.profile-activity-value{color:#f5f7ff;font-weight:900;font-size:12px}
    .profile-account-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-radius:14px;background:#111b2d;color:#fff;margin-top:10px;border:1px solid rgba(220,229,245,.22)}.profile-account-strip small{display:block;color:#aebbd0;font-size:11px;margin-top:2px}
    .profile-edit-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(220,229,245,.14)}.profile-edit-row p{margin:0;color:#aebbd0;font-size:12px;line-height:1.5}.profile-edit-toggle{border:1px solid rgba(220,229,245,.25);background:#17233a;color:#f5f7ff;border-radius:11px;padding:10px 13px;display:inline-flex;align-items:center;gap:7px;font-weight:900;font-size:12px;white-space:nowrap}
    .profile-edit-form{overflow:hidden;transition:max-height .25s ease,opacity .2s ease,margin-top .25s ease}.profile-edit-form.is-closed{max-height:0!important;opacity:0;margin-top:0!important}.profile-edit-form.is-open{max-height:1000px;opacity:1}.profile-logout-bottom{margin-top:14px;width:100%}
    .profile-auth-hidden{display:none!important}
    @media(max-width:800px){.profile-stat-grid{grid-template-columns:repeat(2,1fr)}.profile-section{padding:15px}.profile-stat strong{font-size:20px}.profile-account-strip{align-items:flex-start;flex-direction:column}.profile-edit-row{align-items:flex-start;flex-direction:column}.profile-edit-toggle{width:100%;justify-content:center}}
  `;
  document.head.appendChild(style);

  // Prevent the existing preview crash before app.js (defer) runs.
  const previewPlatform = q('#previewPlatform');
  if (previewPlatform && !q('#previewAction')) {
    const previewAction = document.createElement('span');
    previewAction.id = 'previewAction';
    previewAction.hidden = true;
    previewPlatform.parentElement.appendChild(previewAction);
  }

  function isLoggedIn() {
    const navProfile = q('#profileNav');
    const authButton = q('#authBtn');
    const loginModal = q('#authModal');
    if (navProfile?.classList.contains('active')) return true;
    if (authButton && !/შესვლა|login/i.test(authButton.textContent || '')) return true;
    if (loginModal?.classList.contains('open')) return false;
    return Boolean(q('#settingsName')?.textContent?.trim() || q('#settingsEmail')?.textContent?.trim());
  }

  function gateProfileAccess() {
    const nav = q('#profileNav');
    const view = q('#profile-settings');
    const logged = isLoggedIn();
    if (nav) nav.classList.toggle('profile-auth-hidden', !logged);
    if (view && !logged) {
      view.classList.add('profile-auth-hidden');
      if (nav) nav.classList.remove('active');
    } else if (view) view.classList.remove('profile-auth-hidden');
  }

  function setupProfileEditor() {
    const form = q('#profileSettingsForm'); if (!form) return;
    const card = form.closest('.settings-card'); if (!card) return;
    form.classList.add('profile-edit-form');
    if (!form.dataset.profileEditState) { form.dataset.profileEditState='closed'; form.classList.add('is-closed'); form.style.maxHeight='0px'; form.style.opacity='0'; form.style.marginTop='0'; }
    let row=q('.profile-edit-row',card);
    if(!row){row=document.createElement('div');row.className='profile-edit-row';row.innerHTML='<p>ანგარიშის ძირითადი ინფორმაციის შეცვლა</p><button type="button" class="profile-edit-toggle" aria-expanded="false"><span class="edit-icon">✎</span><span>რედაქტირება</span></button>';card.insertBefore(row,form);}
    const toggle=q('.profile-edit-toggle',row);
    if(toggle&&!toggle.dataset.bound){toggle.dataset.bound='1';toggle.addEventListener('click',()=>{const open=form.dataset.profileEditState!=='open';form.dataset.profileEditState=open?'open':'closed';form.classList.toggle('is-open',open);form.classList.toggle('is-closed',!open);form.style.maxHeight=open?`${form.scrollHeight+40}px`:'0px';form.style.opacity=open?'1':'0';form.style.marginTop=open?'18px':'0';toggle.setAttribute('aria-expanded',String(open));toggle.querySelector('.edit-icon').textContent=open?'⌃':'✎';toggle.querySelector('span:last-child').textContent=open?'დახურვა':'რედაქტირება';});}
  }

  function placeAccountStrip() {
    const settings=q('#profile-settings'), card=q('.settings-card',settings), avatar=q('#settingsAvatar'); if(!settings||!card||!avatar)return;
    let strip=q('.profile-account-strip',card); const oldIdentity=avatar.nextElementSibling; if(!strip){strip=document.createElement('div');strip.className='profile-account-strip';}
    const val=(s,d='')=>q(s)?.textContent||d;
    const name=val('#settingsName',''), email=val('#settingsEmail',''), role=val('#userPlan','მომხმარებელი');
    strip.innerHTML=`<div><strong>${esc(name||'მომხმარებელი')}</strong><small>${esc(email||'')}</small></div><div><strong>${esc(role)}</strong><small>Exchange ანგარიში</small></div>`;
    if(oldIdentity&&!oldIdentity.classList.contains('profile-account-strip'))oldIdentity.replaceWith(strip);else if(strip.parentElement!==card)avatar.insertAdjacentElement('afterend',strip);
  }

  function render() {
    gateProfileAccess(); if(!isLoggedIn()) return;
    setupProfileEditor(); placeAccountStrip();
    const settings=q('#profile-settings'), layout=q('#profile-settings .settings-layout'); if(!settings||!layout)return;
    let extra=q('#profileExtra'); if(!extra){extra=document.createElement('div');extra.id='profileExtra';extra.className='profile-extra';layout.insertAdjacentElement('afterend',extra);}
    const val=(s,d='0')=>q(s)?.textContent||d;
    const profiles=[...document.querySelectorAll('#profileGrid .profile-card')];
    const socials=profiles.length?profiles.map(c=>{const a=c.querySelector('a');return `<div class="profile-social-item"><span class="profile-social-icon">${esc(c.querySelector('.platform-icon')?.textContent||'◎')}</span><div class="profile-social-info"><strong>${esc(c.querySelector('.info strong')?.textContent||'პროფილი')}</strong><small>${esc(c.querySelector('.info small')?.textContent||'')}</small></div>${a?`<a href="${esc(a.href)}" target="_blank" rel="noopener">გახსნა ↗</a>`:''}</div>`;}).join(''):'<div class="empty">სოციალური პროფილები ჯერ არ დაგიმატებია.</div>';
    const tx=[...document.querySelectorAll('#transactionsList .transaction')].slice(0,5);
    const activity=tx.length?tx.map(r=>`<div class="profile-activity-item"><span class="profile-activity-icon">${esc(r.querySelector('.tx-icon')?.textContent||'↗')}</span><div><strong>${esc(r.querySelector('b')?.textContent||'ოპერაცია')}</strong><small>${esc(r.querySelector('small')?.textContent||'')}</small></div><span class="profile-activity-value">${esc(r.querySelector('strong')?.textContent||'')}</span></div>`).join(''):'<div class="empty">ბოლო აქტივობა ჯერ არ არის.</div>';
    extra.innerHTML=`<div class="profile-stat-grid"><article class="profile-stat"><small>კრედიტები</small><strong>${esc(val('#credits'))}</strong></article><article class="profile-stat"><small>შესრულებული</small><strong>${esc(val('#completedCount'))}</strong></article><article class="profile-stat"><small>დაგროვილი</small><strong>${esc(val('#earnedCount'))}</strong></article><article class="profile-stat"><small>აქტიური კამპანიები</small><strong>${esc(val('#analyticsCampaigns'))}</strong></article></div><article class="profile-section"><div class="profile-section-head"><div><h3>სოციალური პროფილები</h3><small>${esc(val('#profileCount'))} დაკავშირებული პროფილი</small></div><button class="link-btn" data-view-target="profiles">მართვა →</button></div><div class="profile-social-list">${socials}</div></article><article class="profile-section"><div class="profile-section-head"><div><h3>ბოლო აქტივობა</h3><small>კრედიტის ოპერაციები</small></div><button class="link-btn" data-view-target="wallet">ყველას ნახვა →</button></div><div class="profile-activity">${activity}</div></article>`;
  }

  document.addEventListener('DOMContentLoaded',render);
  setInterval(render,1500);
})();
