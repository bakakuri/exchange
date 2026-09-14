(() => {
  let patched = false;
  const patchSdk = () => {
    try {
      const sdk = window.supabase;
      if (!sdk || typeof sdk.createClient !== 'function' || patched) return;
      const originalCreateClient = sdk.createClient.bind(sdk);
      sdk.createClient = (...args) => {
        const client = originalCreateClient(...args);
        const auth = client?.auth;
        if (auth && typeof auth.onAuthStateChange === 'function') {
          const originalOnAuthStateChange = auth.onAuthStateChange.bind(auth);
          auth.onAuthStateChange = callback => originalOnAuthStateChange((event, session) => {
            setTimeout(() => {
              try { callback(event, session); } catch (error) { console.error('Auth state callback failed:', error); }
            }, 0);
          });
        }
        return client;
      };
      patched = true;
    } catch (error) {
      console.error('Auth SDK patch failed:', error);
    }
  };
  const timer = setInterval(() => {
    patchSdk();
    if (patched) clearInterval(timer);
  }, 25);
  patchSdk();
})();
