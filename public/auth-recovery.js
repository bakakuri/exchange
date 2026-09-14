(() => {
  const unlock = () => {
    const modal = document.getElementById('modal');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('drawerBackdrop');
    if (modal && !modal.hidden) {
      const form = modal.querySelector('form');
      if (!form) return;
    }
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  };
  const check = async () => {
    try {
      const sdk = window.supabase;
      if (!sdk || typeof sdk.createClient !== 'function') return;
      const config = await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
      if (!config.configured) return;
      if (!window.__exchangeAuthClient) window.__exchangeAuthClient = sdk.createClient(config.supabaseUrl,config.supabaseAnonKey);
      const {data} = await window.__exchangeAuthClient.auth.getSession();
      if (data?.session) {
        unlock();
        document.body.style.overflow='';
      }
    } catch (e) {}
  };
  setInterval(check, 1200);
  check();
})();
