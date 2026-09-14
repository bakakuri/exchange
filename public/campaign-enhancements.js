(() => {
  const $ = (s, root = document) => root?.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money = v => Number(v || 0).toLocaleString('ka-GE');

  const style = document.createElement('style');
  style.textContent = `
    .campaign-refund-note{margin:12px 0;padding:12px 14px;border:1px solid #e4e9f0;border-radius:12px;background:#f8f9fd;color:#667287;font-size:12px;line-height:1.5}
    .promotion-row{gap:12px;flex-wrap:wrap}
    .promotion-row .promotion-actions{display:flex;align-items:center;gap:7px}
    .promotion-cancel{border:1px solid #f1d4db;background:#fff6f8;color:#d04e69;border-radius:9px;padding:8px 10px;font-size:11px;font-weight:900}
    .promotion-cancel:hover{background:#ffedf1}
  `;
  document.head.appendChild(style);

  function getState(){ try { return typeof state !== 'undefined' ? state : null; } catch { return null; } }

  function render(){
    const list = $('#promotionList');
    const s = getState();
    if (!list || !s?.user || !Array.isArray(s.promotions)) return;

    const rows = [...list.querySelectorAll('.promotion-row')];
    rows.forEach((row, index) => {
      if (!row.dataset.promotionId) {
        const p = s.promotions[index];
        if (p) row.dataset.promotionId = p.id;
      }
      const id = row.dataset.promotionId;
      const p = id ? s.promotions.find(x => x.id === id) : null;
      if (!p || p.status === 'completed' || p.status === 'cancelled' || row.querySelector('.promotion-cancel')) return;
      const actions = document.createElement('div');
      actions.className = 'promotion-actions';
      actions.innerHTML = `<button type="button" class="promotion-cancel" data-cancel-promotion="${esc(p.id)}">გაუქმება</button>`;
      row.appendChild(actions);
    });

    let note = $('#campaignRefundNote');
    if (!note && rows.length) {
      note = document.createElement('div');
      note.id = 'campaignRefundNote';
      note.className = 'campaign-refund-note';
      note.textContent = 'კამპანიის გაუქმებისას დარჩენილი ბიუჯეტი სრულად დაგიბრუნდება კრედიტებში.';
      list.parentElement?.insertBefore(note, list);
    }
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-cancel-promotion]');
    if (!b) return;
    const s = getState();
    if (!s?.supabase || !s?.user) return;
    const id = b.dataset.cancelPromotion;
    const p = s.promotions.find(x => x.id === id);
    if (!p) return;
    const refund = Number(p.remaining_budget ?? 0);
    if (!confirm(`კამპანია გაუქმდება. დარჩენილი ${money(refund)} კრედიტი დაგიბრუნდება. გაგრძელდეს?`)) return;
    b.disabled = true;
    try {
      const r = await s.supabase.rpc('cancel_promotion', { p_promotion_id: id });
      if (r.error) throw r.error;
      if (typeof toast === 'function') toast(`კამპანია გაუქმდა · +${money(r.data)} კრედიტი დაბრუნდა ✓`);
      if (typeof loadData === 'function') await loadData();
    } catch (err) {
      if (typeof toast === 'function') toast(err.message || String(err));
      b.disabled = false;
    }
  });

  function observe(){
    const list=$('#promotionList');
    if(!list||typeof MutationObserver==='undefined')return;
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      requestAnimationFrame(()=>{queued=false;render()});
    });
    observer.observe(list,{childList:true,subtree:true});
    render();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});
  else observe();
})();
