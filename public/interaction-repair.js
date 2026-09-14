(() => {
  const nav = id => { if (typeof showView === 'function') showView(id); };
  const bind = () => {
    document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => nav(el.dataset.view)));
    document.querySelectorAll('[data-view-target]').forEach(el => el.addEventListener('click', () => nav(el.dataset.viewTarget)));

    const menu = document.querySelector('#menuBtn');
    if (menu) menu.onclick = () => { if (typeof openDrawer === 'function') openDrawer(); };

    const mobile = document.querySelector('#mobileMenu');
    if (mobile) mobile.onclick = () => { if (typeof openDrawer === 'function') openDrawer(); };

    const back = document.querySelector('#drawerBackdrop');
    if (back) back.onclick = () => { if (typeof closeDrawer === 'function') closeDrawer(); };

    const avatar = document.querySelector('#topAvatar');
    if (avatar) avatar.onclick = () => {
      if (state?.user) nav('profile-settings');
      else if (typeof auth === 'function') auth(false);
    };

    const authButton = document.querySelector('#authBtn');
    if (authButton) authButton.onclick = () => {
      if (state?.user) {
        if (typeof closeDrawer === 'function') closeDrawer();
        if (typeof logout === 'function') logout();
      } else {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => { if (typeof auth === 'function') auth(false); }, 0);
      }
    };

    const close = document.querySelector('#modalClose');
    if (close) close.onclick = () => { if (typeof closeModal === 'function') closeModal(); };

    const add = document.querySelector('#addProfile');
    if (add) add.onclick = () => { if (typeof addProfile === 'function') addProfile(); };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();
})();
