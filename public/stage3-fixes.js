(() => {
  'use strict';

  const q = (s, root = document) => root.querySelector(s);
  const money = n => Number(n || 0).toLocaleString('ka-GE');
  const labels = {
    task_reward: 'დავალების ჯილდო',
    promotion_spend: 'კამპანიის ხარჯი',
    promotion_refund: 'კამპანიის თანხის დაბრუნება',
    opening_balance: 'საწყისი ბალანსი',
    admin_adjustment: 'ადმინისტრატორის კორექცია',
    signup_bonus: 'საწყისი ბონუსი'
  };

  function style() {
    if (q('#stage3-style')) return;
    const s = document.createElement('style');
    s.id = 'stage3-style';
    s.textContent = `
      /* Wallet: keep the original balance card and move search into a stable toolbar. */
      #stage2WalletHead { display:none !important; }
      #stage3WalletTools { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:12px 0 10px; }
      #stage3WalletTools .stage3-wallet-label { font-size:12px; font-weight:800; color:var(--muted,#8b95a6); }
      #stage3WalletFilter { width:min(300px,100%); border:1px solid var(--line,#dfe4ec); background:var(--card,#fff); color:inherit; border-radius:12px; padding:11px 13px; outline:0; font:inherit; }
      #stage3WalletFilter:focus { border-color:#7180ee; box-shadow:0 0 0 3px rgba(102,117,244,.08); }
      #stage3WalletList { display:block; }
      #transactionsList { display:none !important; }
      body.dark #stage3WalletFilter { background:#111a2b; border-color:#2b3850; color:#eef2fa; }
      body.dark #stage3WalletTools .stage3-wallet-label { color:#8996ac; }
      @media(max-width:760px){
        #stage3WalletTools { align-items:stretch; flex-direction:column; gap:8px; }
        #stage3WalletFilter { width:100%; }
      }
      /* Notification icon should remain visible and unmistakable on mobile. */
      .top-actions .notification { display:grid !important; place-items:center; }
      .top-actions .notification svg { width:19px; height:19px; display:block; }
      .top-actions .notification i { right:4px; top:4px; width:17px; height:17px; min-width:17px; border-radius:999px; display:grid; place-items:center; background:#e95772; color:#fff; font:800 9px/1 Inter,sans-serif; font-style:normal; }
      .top-actions .notification i:empty { display:none; }
      .stage3-notification-empty { padding:22px 12px; text-align:center; color:#8b95a6; font-size:13px; }
      .stage3-notification-empty strong { display:block; color:inherit; margin-bottom:4px; }
    `;
    document.head.appendChild(s);
  }

  function walletRows(term='') {
    let s;
    try { s = typeof state !== 'undefined' ? state : null; } catch { s = null; }
    const rows = Array.isArray(s?.transactions) ? s.transactions : [];
    const needle = term.trim().toLocaleLowerCase('ka-GE');
    return rows.filter(x => {
      const text = `${labels[x.type] || x.type || ''} ${x.amount || ''}`.toLocaleLowerCase('ka-GE');
      return !needle || text.includes(needle);
    }).slice(0, 50);
  }

  function renderWallet() {
    const host = q('#wallet'), tx = q('.transactions', host || document);
    if (!host || !tx) return;
    let tools = q('#stage3WalletTools');
    if (!tools) {
      tools = document.createElement('div');
      tools.id = 'stage3WalletTools';
      tools.innerHTML = '<span class="stage3-wallet-label">ბოლო ოპერაციები</span><input id="stage3WalletFilter" type="search" placeholder="🔍 მოძებნე ოპერაცია..." autocomplete="off">';
      tx.insertBefore(tools, q('#transactionsList', tx));
      const input = q('#stage3WalletFilter');
      input.addEventListener('input', () => renderWalletList(input.value));
    }
    renderWalletList(q('#stage3WalletFilter')?.value || '');
  }

  let walletRendering = false;
  function renderWalletList(term='') {
    const old = q('#transactionsList'), input = q('#stage3WalletFilter');
    if (!old || !input) return;
    let list = q('#stage3WalletList');
    if (!list) {
      list = document.createElement('div');
      list.id = 'stage3WalletList';
      old.parentElement.insertBefore(list, old);
    }
    const rows = walletRows(term);
    walletRendering = true;
    list.innerHTML = rows.length ? rows.map(x => {
      const amount = Number(x.amount || 0);
      const positive = amount > 0;
      return `<div class="transaction"><span class="tx-icon ${positive ? 'tx-positive' : 'tx-negative'}">${positive ? '↑' : '↓'}</span><div><b>${labels[x.type] || 'ოპერაცია'}</b><small>${new Date(x.created_at).toLocaleString('ka-GE')}</small></div><strong class="${positive ? 'positive' : 'negative'}">${positive ? '+' : ''}${money(amount)}</strong></div>`;
    }).join('') : '<div class="stage3-notification-empty">ოპერაციები ვერ მოიძებნა.</div>';
    walletRendering = false;
  }

  function normalizeNotificationIcon() {
    const b = q('#notifyBtn');
    if (!b) return;
    if (!q('svg', b)) {
      b.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('fill','none');
      svg.setAttribute('stroke','currentColor');
      svg.setAttribute('stroke-width','1.8');
      svg.setAttribute('stroke-linecap','round');
      svg.setAttribute('stroke-linejoin','round');
      svg.innerHTML = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>';
      b.insertBefore(svg, b.firstChild);
    }
  }

  function boot() {
    style();
    normalizeNotificationIcon();
    renderWallet();
    const list = q('#transactionsList');
    if (list && !list.dataset.stage3Observed) {
      list.dataset.stage3Observed = '1';
      const observer = new MutationObserver(() => {
        if (!walletRendering) renderWalletList(q('#stage3WalletFilter')?.value || '');
      });
      observer.observe(list, {childList:true, subtree:true});
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
  setInterval(boot, 1200);
})();
