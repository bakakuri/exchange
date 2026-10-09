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
//
// Page fragments are written in English; each is translated into the
// active language (core/i18n.js) before its module runs, and refresh()
// re-renders the current page after a language switch.
//
// Page modules may also export:
//   destroy()        - called before the next page renders (stop timers,
//                      polls, recordings);
//   update(params)   - called instead of a full re-render when the next
//                      route uses the same page module (e.g. /messages ->
//                      /messages/:id keeps the inbox on screen).
// <html data-route="/messages/:id"> names the current route for CSS.

import { t, translateDom } from './i18n.js';

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
  adminOnly = false,
} = {}) {
  routes.push({
    path,
    fragment,
    module,
    title,
    protected: isProtected,
    guestOnly,
    adminOnly,
    ...compilePattern(path),
  });
}

export function setRouteGuard(fn) {
  guard = fn;
}

const root = () => document.getElementById('app-root');
let current = null; // { route, mod } of the page on screen
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

let renderCount = 0; // a newer navigation makes an unfinished render give up

async function render(fullPath, { force = false } = {}) {
  const ticket = ++renderCount;
  // A link may carry a query (e.g. /profile?link=instagram); routes match the path.
  const path = fullPath.split(/[?#]/)[0];
  const { route, params } = resolve(path);

  if (guard) {
    const redirect = guard(route, path);
    if (redirect && redirect !== path) {
      navigate(redirect, { replace: true });
      return;
    }
  }

  // Same page, new params: let the page move itself (no flash, no refetch).
  if (!force && current?.mod?.update && route.module && current.route.module === route.module) {
    current.route = route;
    document.title = t(route.title);
    document.documentElement.dataset.route = route.path;
    current.mod.update(params);
    return;
  }

  try {
    current?.mod?.destroy?.();
  } catch {
    // a page that fails to clean up must not block the next one
  }
  current = null;

  const res = await fetch(route.fragment);
  const html = await res.text();
  if (ticket !== renderCount) return;
  root().innerHTML = html;
  translateDom(root());
  document.title = t(route.title);
  document.documentElement.dataset.route = route.path;

  if (route.module) {
    const mod = await import(route.module);
    if (ticket !== renderCount) return;
    current = { route, mod };
    mod.init?.(params);
  } else {
    current = { route, mod: null };
  }
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render(path);
}

/** Render the current path again (e.g. after the language changes). */
export function refresh() {
  return render(location.pathname, { force: true });
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
