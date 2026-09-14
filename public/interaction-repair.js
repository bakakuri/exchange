(() => {
  const nav = id => { if (typeof showView === 'function') showView(id); };
  const bind = () => {
    document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => nav(el.dataset.view)));
    document.querySelectorAll('[data-view-target]').forEach(el => el.addEventListener('click', () => nav(el.dataset.viewTarget)));
    const menu = document.querySelector('#menuBtn');
    if (menu) menu.addEventListener('click', () => { if (typeof openDrawer === 'function') openDrawer(); });
    const mobile = document.querySelector('#mobileMenu');
    if (mobile) mobile.addEventListener('click', () => { if (typeof openDrawer === 'function') openDrawer(); });
    const back = document.querySelector('#drawerBackdrop');
    if (back) back.addEventListener('click', () => { if (typeof closeDrawer === 'function') closeDrawer(); });
    const avatar = document.querySelector('#topAvatar');
    if (avatar) avatar.addEventListener('click', () => { if (state?.user) nav('profile-settings'); else if (typeof auth === 'function') auth(false); });
    const authButton = document.querySelector('#authBtn');
    if (authButton) authButton.addEventListener('click', () => { if (state?.user) { if (typeof logout === 'function') logout(); } else if (typeof auth === 'function') auth(false); });
    const close = document.querySelector('#modalClose');
    if (close) close.addEventListener('click', () => { if (typeof closeModal === 'function') closeModal(); });
    const add = document.querySelector('#addProfile');
    if (add) add.addEventListener('click', () => { if (typeof addProfile === 'function') addProfile(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();
})();
