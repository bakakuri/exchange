(() => {
  const unlock = () => {
    const modal = document.getElementById('modal');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('drawerBackdrop');
    if (modal) {
      modal.hidden = true;
      modal.removeAttribute('open');
    }
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.style.overflow='';
  };
  const check = async () => {
    try {
      const sdk = window.supabase;
      if (!sdk || typeof sdk.createClient !== 'function') return;
      const config = await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
      if (!config.configured) return;
      if (!window.__exchangeAuthClient) window.__exchangeAuthClient = sdk.createClient(config.supabaseUrl,config.supabaseAnonKey);
      const {data} = await window.__exchangeAuthClient.auth.getSession();
      if (data?.session) unlock();
    } catch (e) {}
  };
  setInterval(check, 1200);
  check();
})();
