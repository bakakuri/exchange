(() => {
  let patched = false;
  const patch = () => {
    try {
      const s = window.state;
      const auth = s?.supabase?.auth;
      if (!auth || patched || typeof auth.onAuthStateChange !== 'function') return;
      const original = auth.onAuthStateChange.bind(auth);
      auth.onAuthStateChange = (callback) => original((event, session) => {
        setTimeout(() => {
          try { callback(event, session); } catch (error) { console.error('Auth state callback failed:', error); }
        }, 0);
      });
      patched = true;
    } catch (error) {
      console.error('Auth event patch failed:', error);
    }
  };
  const timer = setInterval(() => {
    patch();
    if (patched) clearInterval(timer);
  }, 25);
  patch();
})();
