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
    if (avatar) avatar.addEventListener('click', () => { if (typeof showView === 'function') showView('profile-settings'); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();
})();
