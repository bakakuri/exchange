(() => {
  const q = (s, root = document) => root.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  const style = document.createElement('style');
  style.textContent = `
    .profile-extra{margin-top:14px;display:grid;gap:14px}
    .profile-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .profile-stat{padding:15px;border:1px solid #e4e9f0;border-radius:16px;background:#fff}
    .profile-stat small{display:block;color:#8a94a5;font-size:12px;margin-bottom:6px}
    .profile-stat strong{display:block;color:#172033;font:700 22px "Space Grotesk",sans-serif}
    .profile-section{background:#fff;border:1px solid #e4e9f0;border-radius:19px;padding:18px}
    .profile-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
    .profile-section-head h3{margin:0;font-size:18px}
    .profile-section-head small{color:#8993a4;font-size:12px}
    .profile-social-list,.profile-activity{display:grid;gap:8px}
    .profile-social-item{display:flex;align-items:center;gap:11px;padding:11px;border-radius:13px;background:#f8f9fc;border:1px solid #edf0f5}
    .profile-social-icon{width:38px;height:38px;border-radius:11px;background:#eef1ff;color:#5662e3;display:grid;place-items:center;font-weight:900}
    .profile-social-info{min-width:0;flex:1}.profile-social-info strong{display:block;font-size:13px}.profile-social-info small{display:block;color:#8993a4;font-size:11px;margin-top:3px}
    .profile-social-item a{color:#5360e3;text-decoration:none;font-size:12px;font-weight:800}
    .profile-activity-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}
    .profile-activity-item:last-child{border-bottom:0}.profile-activity-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:#e9faf2;color:#159a62;font-weight:900}
    .profile-activity-item div:nth-child(2){min-width:0;flex:1}.profile-activity-item strong{display:block;font-size:12px}.profile-activity-item small{display:block;color:#8d96a5;font-size:10px;margin-top:2px}.profile-activity-value{font-weight:900;font-size:12px}
    .profile-account-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-radius:14px;background:#111b2d;color:#fff}
    .profile-account-strip small{display:block;color:#9aa8bf;font-size:11px;margin-top:2px}
    .profile-edit-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid #edf0f5}
    .profile-edit-row p{margin:0;color:#8993a4;font-size:12px;line-height:1.5}
    .profile-edit-toggle{border:1px solid #dfe5ee;background:#f7f8fc;color:#5360e4;border-radius:11px;padding:10px 13px;display:inline-flex;align-items:center;gap:7px;font-weight:900;font-size:12px;white-space:nowrap}
    .profile-edit-toggle:hover{background:#eef1ff;border-color:#d6dcff}.profile-edit-toggle .edit-icon{font-size:15px;line-height:1}
    .profile-edit-form{overflow:hidden;transition:max-height .25s ease,opacity .2s ease,margin-top .25s ease}.profile-edit-form.is-closed{max-height:0!important;opacity:0;margin-top:0!important}.profile-edit-form.is-open{max-height:1000px;opacity:1}
    .profile-logout-card{order:999}.profile-logout-card .danger-btn{margin-top:8px}
    @media(max-width:800px){
      .profile-stat-grid{grid-template-columns:repeat(2,1fr)}.profile-section{padding:15px}.profile-stat strong{font-size:20px}.profile-account-strip{align-items:flex-start;flex-direction:column}
      .profile-edit-row{align-items:flex-start;flex-direction:column}.profile-edit-toggle{width:100%;justify-content:center}
    }
  `;
  document.head.appendChild(style);

  // Fix the existing preview crash before app.js (defer) runs.
  const previewPlatform = q('#previewPlatform');
  if (previewPlatform && !q('#previewAction')) {
    const previewAction = document.createElement('span');
    previewAction.id = 'previewAction';
    previewAction.hidden = true;
    previewPlatform.parentElement.appendChild(previewAction);
  }

  function setupProfileEditor() {
    const form = q('#profileSettingsForm');
    if (!form) return;
    const card = form.closest('.settings-card');
    if (!card) return;

    form.classList.add('profile-edit-form');
    if (!form.dataset.profileEditState) {
      form.dataset.profileEditState = 'closed';
      form.classList.add('is-closed');
      form.style.maxHeight = '0px';
      form.style.opacity = '0';
      form.style.overflow = 'hidden';
      form.style.marginTop = '0';
    }

    let row = q('.profile-edit-row', card);
    if (!row) {
      row = document.createElement('div');
      row.className = 'profile-edit-row';
      row.innerHTML = '<p>ანგარიშის ძირითადი ინფორმაციის შეცვლა</p><button type="button" class="profile-edit-toggle" aria-expanded="false"><span class="edit-icon">✎</span><span>რედაქტირება</span></button>';
      card.insertBefore(row, form);
    }

    const toggle = q('.profile-edit-toggle', row);
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', () => {
        const open = form.dataset.profileEditState !== 'open';
        form.dataset.profileEditState = open ? 'open' : 'closed';
        form.classList.toggle('is-open', open);
        form.classList.toggle('is-closed', !open);
        form.style.maxHeight = open ? `${form.scrollHeight + 40}px` : '0px';
        form.style.opacity = open ? '1' : '0';
        form.style.marginTop = open ? '18px' : '0';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.querySelector('.edit-icon').textContent = open ? '⌃' : '✎';
        toggle.querySelector('span:last-child').textContent = open ? 'დახურვა' : 'რედაქტირება';
      });
    }
  }

  function moveLogoutToBottom() {
    const settings = q('#profile-settings');
    if (!settings) return;
    const layout = q('.settings-layout', settings);
    if (!layout) return;
    const danger = q('.danger-btn', settings);
    if (!danger) return;
    const card = danger.closest('.settings-card');
    if (card && card.parentElement === layout) card.classList.add('profile-logout-card');
  }

  function render() {
    setupProfileEditor();
    moveLogoutToBottom();

    const layout = q('#profile-settings .settings-layout');
    if (!layout) return;
    let extra = q('#profileExtra');
    if (!extra) {
      extra = document.createElement('div');
      extra.id = 'profileExtra';
      extra.className = 'profile-extra';
      layout.insertAdjacentElement('afterend', extra);
    }

    const val = (s, d = '0') => q(s)?.textContent || d;
    const profiles = [...document.querySelectorAll('#profileGrid .profile-card')];
    const socials = profiles.length ? profiles.map(c => {
      const a = c.querySelector('a');
      return `<div class="profile-social-item"><span class="profile-social-icon">${esc(c.querySelector('.platform-icon')?.textContent || '◎')}</span><div class="profile-social-info"><strong>${esc(c.querySelector('.info strong')?.textContent || 'პროფილი')}</strong><small>${esc(c.querySelector('.info small')?.textContent || '')}</small></div>${a ? `<a href="${esc(a.href)}" target="_blank" rel="noopener">გახსნა ↗</a>` : ''}</div>`;
    }).join('') : '<div class="empty">სოციალური პროფილები ჯერ არ დაგიმატებია.</div>';

    const tx = [...document.querySelectorAll('#transactionsList .transaction')].slice(0, 5);
    const activity = tx.length ? tx.map(r => `<div class="profile-activity-item"><span class="profile-activity-icon">${esc(r.querySelector('.tx-icon')?.textContent || '↗')}</span><div><strong>${esc(r.querySelector('b')?.textContent || 'ოპერაცია')}</strong><small>${esc(r.querySelector('small')?.textContent || '')}</small></div><span class="profile-activity-value">${esc(r.querySelector('strong')?.textContent || '')}</span></div>`).join('') : '<div class="empty">ბოლო აქტივობა ჯერ არ არის.</div>';

    extra.innerHTML = `<div class="profile-account-strip"><div><strong>${esc(val('#settingsName', 'მომხმარებელი'))}</strong><small>${esc(val('#settingsEmail', 'ელფოსტა არ არის მითითებული'))}</small></div><div><strong>${esc(val('#userPlan', 'მომხმარებელი'))}</strong><small>Exchange ანგარიში</small></div></div><div class="profile-stat-grid"><article class="profile-stat"><small>კრედიტები</small><strong>${esc(val('#credits'))}</strong></article><article class="profile-stat"><small>შესრულებული</small><strong>${esc(val('#completedCount'))}</strong></article><article class="profile-stat"><small>დაგროვილი</small><strong>${esc(val('#earnedCount'))}</strong></article><article class="profile-stat"><small>აქტიური კამპანიები</small><strong>${esc(val('#analyticsCampaigns'))}</strong></article></div><article class="profile-section"><div class="profile-section-head"><div><h3>სოციალური პროფილები</h3><small>${esc(val('#profileCount'))} დაკავშირებული პროფილი</small></div><button class="link-btn" data-view-target="profiles">მართვა →</button></div><div class="profile-social-list">${socials}</div></article><article class="profile-section"><div class="profile-section-head"><div><h3>ბოლო აქტივობა</h3><small>კრედიტის ოპერაციები</small></div><button class="link-btn" data-view-target="wallet">ყველას ნახვა →</button></div><div class="profile-activity">${activity}</div></article>`;
  }

  document.addEventListener('DOMContentLoaded', render);
  setInterval(render, 1500);
})();
