(() => {
  'use strict';
  const qa = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));

  function polish(){
    qa('#allTasks .task-card, #dashboardTasks .task-card').forEach(card => {
      if (card.dataset.taskMetaPolished === '1') return;
      const content = card.querySelector(':scope > div:first-child');
      const small = content?.querySelector(':scope > small');
      if (!content || !small) return;
      const parts = small.textContent.split('·').map(x => x.trim()).filter(Boolean);
      const category = parts[0] || 'დავალება';
      const action = parts.slice(1).join(' · ') || '';
      const meta = document.createElement('div');
      meta.className = 'task-context-right';
      meta.innerHTML = `<span class="task-context-category">${esc(category)}</span>${action ? `<span class="task-context-action">${esc(action)}</span>` : ''}`;
      card.appendChild(meta);
      small.remove();
      card.dataset.taskMetaPolished = '1';
    });
  }

  const boot = () => {
    polish();
    ['#allTasks','#dashboardTasks'].forEach(sel => {
      const host = document.querySelector(sel);
      if (host && !host.dataset.taskMetaObserver && typeof MutationObserver !== 'undefined') {
        host.dataset.taskMetaObserver = '1';
        new MutationObserver(() => polish()).observe(host, {childList:true, subtree:true});
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
