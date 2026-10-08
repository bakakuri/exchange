// js/admin/admin.js - behavior for the /admin route.
//
// Two sections rendered on load:
//  1. Stats tiles  – platform-wide aggregate counts from GET /api/admin/stats
//  2. User list    – cursor-paginated, searchable; links to /admin/users/:id

import { api } from '../shared/api.js';
import { navigate } from '../core/router.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { t, formatNumber } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';
import { roleLabel } from './labels.js';

// ── stats ───────────────────────────────────────────────────────────────────

async function renderStats(statsEl) {
  statsEl.replaceChildren(createEl('span', { class: 'admin-stats__loading' }, t('Loading stats…')));

  try {
    const { stats } = await api.admin.stats();
    statsEl.innerHTML = '';

    const tiles = [
      { label: t('Total users'), value: stats.total_users },
      { label: t('Total campaigns'), value: stats.total_campaigns },
      { label: t('Active campaigns'), value: stats.active_campaigns },
      { label: t('Total completions'), value: stats.total_completions },
      { label: t('Pending verifications'), value: stats.pending_verifications },
      { label: t('Open reports'), value: stats.pending_reports, link: '/admin/reports' },
    ];

    for (const tile of tiles) {
      const tileEl = createEl('div', { class: 'admin-stat-tile' }, [
        createEl('span', { class: 'admin-stat-tile__value' }, formatNumber(tile.value ?? 0)),
        createEl('span', { class: 'admin-stat-tile__label' }, tile.label),
      ]);
      // Tiles with a link are clickable.
      if (tile.link) {
        tileEl.classList.add('admin-stat-tile--link');
        tileEl.setAttribute('role', 'button');
        tileEl.setAttribute('tabindex', '0');
        tileEl.addEventListener('click', () => navigate(tile.link));
        tileEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') navigate(tile.link);
        });
      }
      statsEl.append(tileEl);
    }
  } catch (err) {
    statsEl.innerHTML = '';
    statsEl.append(
      createEl('p', { class: 'form-error' }, errorMessage(err, 'Could not load stats.'))
    );
  }
}

// ── user list ───────────────────────────────────────────────────────────────

function renderUserRow(user, listEl) {
  const roleClass = `admin-user-role--${user.role}`;
  const statusClass = user.status === 'suspended' ? 'admin-user-row--suspended' : '';

  const row = createEl('li', { class: `admin-user-row ${statusClass}`.trim() }, [
    createEl('a', { class: 'admin-user-row__link', href: `/admin/users/${user.id}`, 'data-link': '' }, [
      createEl('span', { class: 'admin-user-row__name' }, user.display_name || user.username || t('(no name)')),
      createEl('span', { class: 'admin-user-row__username' }, `@${user.username || '—'}`),
    ]),
    createEl('div', { class: 'admin-user-row__meta' }, [
      createEl('span', { class: `admin-user-role ${roleClass}` }, roleLabel(user.role)),
      createEl('span', { class: 'admin-user-row__credits' }, t('{n} cr', { n: formatNumber(user.credits ?? 0) })),
      createEl('span', { class: 'admin-user-row__date' }, shortDate(user.created_at)),
    ]),
  ]);

  listEl.append(row);
}

let currentCursor = null;
let currentSearch = '';
let isLoading = false;

async function loadUsers(listEl, emptyEl, loadMoreBtn, errorEl, reset = false) {
  if (isLoading) return;
  isLoading = true;
  if (loadMoreBtn) loadMoreBtn.disabled = true;

  if (reset) {
    currentCursor = null;
    listEl.innerHTML = '';
    emptyEl.hidden = true;
  }

  const params = {};
  if (currentCursor) params.before = currentCursor;
  if (currentSearch) params.search = currentSearch;

  try {
    const { users, next_cursor } = await api.admin.users(params);
    currentCursor = next_cursor;
    if (loadMoreBtn) loadMoreBtn.hidden = !next_cursor;

    if (users.length) {
      emptyEl.hidden = true;
      for (const u of users) renderUserRow(u, listEl);
    } else if (!listEl.children.length) {
      emptyEl.hidden = false;
    }
  } catch (err) {
    errorEl.textContent = errorMessage(err, 'Could not load users.');
    errorEl.hidden = false;
  } finally {
    isLoading = false;
    if (loadMoreBtn) loadMoreBtn.disabled = false;
  }
}

// ── init ───────────────────────────────────────────────────────────────────

export async function init() {
  const statsEl = qs('[data-admin-stats]');
  const searchInput = qs('[data-admin-search]');
  const listEl = qs('[data-admin-user-list]');
  const emptyEl = qs('[data-admin-users-empty]');
  const loadMoreBtn = qs('[data-admin-load-more]');
  const errorEl = qs('#admin-list-error');

  if (statsEl) renderStats(statsEl);

  if (!listEl) return;
  currentCursor = null;
  currentSearch = '';

  await loadUsers(listEl, emptyEl, loadMoreBtn, errorEl, true);

  // Search: debounce, reload from top on each keystroke after a pause.
  let debounce = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentSearch = searchInput.value.trim();
        loadUsers(listEl, emptyEl, loadMoreBtn, errorEl, true);
      }, 300);
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () =>
      loadUsers(listEl, emptyEl, loadMoreBtn, errorEl)
    );
  }
}
