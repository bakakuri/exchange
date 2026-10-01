// js/core/router.js
// Lightweight fragment router: on navigation it fetches the target page's
// HTML fragment from /pages/*.html and swaps it into #app-root, then
// dynamically imports that page's JS module (if one is registered) and
// calls its init(params). A hard refresh at any path is served the same
// shell by the server's SPA fallback (server/server.js), so deep links
// keep working even though rendering itself is client-side.
//
// The router core knows nothing about specific pages - each feature
// registers its own routes via registerRoute() (see */routes.js, wired
// up through core/routes-manifest.js), including ones with :param
// segments (e.g. "/u/:username"). A single guard function, set with
// setRouteGuard(), can redirect a navigation before it renders; that's
// how protected/guestOnly routes work (see core/route-guards.js) without
// the router itself knowing anything about authentication.

const routes = [];
let guard = null;

function compilePattern(pattern) {
  const paramNames = [];
  const regexSource = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexSource}$`), paramNames };
}

export function registerRoute(path, {
  fragment,
  module = null,
  title = 'Exchange',
  protected: isProtected = false,
  guestOnly = false,
} = {}) {
  routes.push({
    path,
    fragment,
    module,
    title,
    protected: isProtected,
    guestOnly,
    ...compilePattern(path),
  });
}

export function setRouteGuard(fn) {
  guard = fn;
}

const root = () => document.getElementById('app-root');
const home = () => routes.find((r) => r.path === '/');

function resolve(path) {
  for (const route of routes) {
    const match = route.regex.exec(path);
    if (!match) continue;
    const params = {};
    route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
    return { route, params };
  }
  return { route: home(), params: {} };
}

async function render(path) {
  const { route, params } = resolve(path);

  if (guard) {
    const redirect = guard(route, path);
    if (redirect && redirect !== path) {
      navigate(redirect, { replace: true });
      return;
    }
  }

  const res = await fetch(route.fragment);
  root().innerHTML = await res.text();
  document.title = route.title;

  if (route.module) {
    const mod = await import(route.module);
    mod.init?.(params);
  }
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render(path);
}

export function init() {
  document.body.addEventListener('click', (e) => {
    const link = e.target.closest('[data-link]');
    if (!link) return;
    e.preventDefault();
    navigate(link.getAttribute('href'));
  });

  window.addEventListener('popstate', () => render(location.pathname));

  render(location.pathname);
}
