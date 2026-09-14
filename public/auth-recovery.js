(() => {
  let syncing = false;
  let syncedUserId = null;

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
    document.body.style.overflow = '';
  };

  const syncAppState = async (session) => {
    try {
      if (typeof state === 'undefined') return;
      const nextUser = session?.user || null;
      const nextId = nextUser?.id || null;
      if (!nextUser) {
        if (state.user) {
          state.user = null;
          state.profile = null;
          syncedUserId = null;
          if (typeof loadData === 'function') await loadData();
        }
        return;
      }
      if (state.user?.id === nextId && syncedUserId === nextId) return;
      state.user = nextUser;
      syncedUserId = nextId;
      unlock();
      if (typeof loadData === 'function') await loadData();
      if (typeof identity === 'function') identity();
      if (typeof syncBottomNav === 'function') syncBottomNav();
    } catch (e) {
      console.error('Auth recovery failed:', e);
    }
  };

  const check = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const sdk = window.supabase;
      if (!sdk || typeof sdk.createClient !== 'function') return;
      const config = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
      if (!config.configured) return;
      if (!window.__exchangeAuthClient) {
        window.__exchangeAuthClient = sdk.createClient(config.supabaseUrl, config.supabaseAnonKey);
      }
      const { data } = await window.__exchangeAuthClient.auth.getSession();
      if (data?.session) unlock();
      await syncAppState(data?.session || null);
    } catch (e) {
      console.error('Auth recovery check failed:', e);
    } finally {
      syncing = false;
    }
  };

  setInterval(check, 900);
  check();
})();
