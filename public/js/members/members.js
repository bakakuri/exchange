// js/members/members.js - the /members directory (022).
//
// Everyone registered and active, as cards: cover, photo with a green dot
// when online, field of work, level and what they've done. Filters:
//   - groups the site works out itself: online, creators (have campaigns),
//     doers (have approved tasks), new (this week), top (most XP), admins;
//   - the field of work members pick in their profile;
//   - a search over names and usernames, and a sort.
// The filters live in the address (?segment=online&category=gamer&q=ana),
// so a filtered list can be shared or bookmarked.
// "Online" and "last seen" appear only for members who allow it - the
// server leaves them out otherwise (member_directory()).

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { avatar, icon } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { MEMBER_CATEGORIES, categoryChip } from '../shared/member-categories.js';
import { presenceLine } from '../shared/presence.js';
import { roleLabel } from '../admin/labels.js';
import { t, tn, formatNumber } from '../core/i18n.js';

const SEGMENTS = [
  { value: '', icon: 'i-users-round', label: () => t('Everyone'), count: 'all' },
  { value: 'online', icon: 'i-circle-dot', label: () => t('Online now'), count: 'online' },
  { value: 'creators', icon: 'i-megaphone', label: () => t('Creators'), count: 'creators' },
  { value: 'doers', icon: 'i-circle-check', label: () => t('Doers'), count: 'doers' },
  { value: 'new', icon: 'i-rocket', label: () => t('New this week'), count: 'new' },
  { value: 'top', icon: 'i-crown', label: () => t('Top by XP'), count: 'top' },
  { value: 'admins', icon: 'i-shield', label: () => t('Admins'), count: 'admins' },
];
const SORTS = ['active', 'new', 'level'];

function readFilters() {
  const params = new URLSearchParams(location.search);
  const segment = params.get('segment') || '';
  const category = params.get('category') || '';
  const sort = params.get('sort') || '';
  return {
    search: (params.get('q') || '').slice(0, 60),
    segment: SEGMENTS.some((s) => s.value === segment) ? segment : '',
    category: MEMBER_CATEGORIES.some((c) => c.value === category) ? category : '',
    sort: SORTS.includes(sort) ? sort : '',
  };
}

function writeFilters(filters) {
  const params = new URLSearchParams();
  if (filters.search) params.set('q', filters.search);
  if (filters.segment) params.set('segment', filters.segment);
  if (filters.category) params.set('category', filters.category);
  if (filters.sort) params.set('sort', filters.sort);
  const text = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${text ? `?${text}` : ''}`);
}

// The sort a group uses unless the member picks another.
const defaultSort = (segment) => (segment === 'top' ? 'level' : segment === 'new' ? 'new' : 'active');

// ── cards ───────────────────────────────────────────────────────────────────

function memberCard(member, { showRank }) {
  const name = member.display_name || member.username;
  const cover = createEl('span', { class: `member-card__cover ${member.cover_url ? 'has-photo' : ''}`.trim(), 'aria-hidden': 'true' });
  if (member.cover_url) {
    cover.append(createEl('img', { src: member.cover_url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
  }

  const tags = createEl('span', { class: 'member-card__tags' });
  const chip = categoryChip(member.category);
  if (chip) tags.append(chip);
  if (member.role === 'admin') tags.append(createEl('span', { class: 'role-chip' }, [icon('i-shield', { size: 14 }), roleLabel('admin')]));

  const stats = createEl('span', { class: 'member-card__stats' }, [
    createEl('span', { class: 'level-pill' }, t('Level {n}', { n: member.level })),
    createEl('span', {}, tn(member.campaigns_count || 0, '{n} campaign', '{n} campaigns')),
    createEl('span', {}, tn(member.completed_count || 0, '{n} task done', '{n} tasks done')),
  ]);

  const body = createEl('span', { class: 'member-card__body' }, [
    avatar(name, { size: 'lg', url: member.avatar_url, online: member.is_online === true }),
    createEl('span', { class: 'member-card__name' }, name),
    createEl('span', { class: 'member-card__handle' }, `@${member.username}`),
  ]);
  if (tags.childNodes.length) body.append(tags);
  body.append(stats);
  const presence = presenceLine(member, { className: 'member-card__presence' });
  if (presence) body.append(presence);

  const link = createEl('a', { class: 'member-card__link', href: `/u/${encodeURIComponent(member.username)}`, 'data-link': '' }, [cover, body]);
  if (showRank && member.xp_rank) {
    link.append(createEl('span', { class: `member-card__rank ${member.xp_rank <= 3 ? 'member-card__rank--podium' : ''}`.trim() }, [
      icon('i-crown', { size: 14 }), `#${member.xp_rank}`,
    ]));
  }
  return createEl('li', { class: 'member-card' }, [link]);
}

function skeletonCards(count) {
  return Array.from({ length: count }, () => createEl('li', { class: 'member-card member-card--skeleton', 'aria-hidden': 'true' }, [
    createEl('span', { class: 'member-card__cover skeleton' }),
    createEl('span', { class: 'member-card__body' }, [
      createEl('span', { class: 'avatar avatar--lg skeleton' }),
      createEl('span', { class: 'skeleton skeleton--line' }),
      createEl('span', { class: 'skeleton skeleton--line skeleton--short' }),
    ]),
  ]));
}

// ── page ────────────────────────────────────────────────────────────────────

export async function init() {
  const listEl = qs('[data-members-list]');
  if (!listEl) return;
  const searchEl = qs('[data-members-search]');
  const segmentsEl = qs('[data-members-segments]');
  const categoriesEl = qs('[data-members-categories]');
  const sortEl = qs('[data-members-sort]');
  const countEl = qs('[data-members-count]');
  const errorEl = qs('[data-members-error]');
  const moreBtn = qs('[data-members-more]');

  const filters = readFilters();
  let counts = null;
  let nextOffset = null;
  let requestId = 0;
  // Who is already on screen: activity can shift someone between pages,
  // and they shouldn't then appear twice.
  const shown = new Set();

  searchEl.value = filters.search;
  sortEl.value = filters.sort || defaultSort(filters.segment);

  function renderSegments() {
    segmentsEl.innerHTML = '';
    for (const segment of SEGMENTS) {
      const n = counts?.[segment.count];
      const pressed = filters.segment === segment.value;
      const btn = createEl('button', {
        type: 'button',
        class: `segment-tab ${segment.value === 'online' ? 'segment-tab--online' : ''}`.trim(),
        'aria-pressed': pressed ? 'true' : 'false',
      }, [icon(segment.icon, { size: 16 }), createEl('span', {}, segment.label())]);
      if (n != null) btn.append(createEl('span', { class: 'segment-tab__count' }, formatNumber(n)));
      btn.addEventListener('click', () => {
        if (filters.segment === segment.value) return;
        filters.segment = segment.value;
        filters.sort = '';
        sortEl.value = defaultSort(filters.segment);
        renderSegments();
        load({ reset: true });
      });
      segmentsEl.append(btn);
    }
  }

  function renderCategories() {
    categoriesEl.innerHTML = '';
    const all = [{ value: '', icon: 'i-layers', label: t('All fields') }, ...MEMBER_CATEGORIES];
    for (const category of all) {
      const n = category.value ? counts?.categories?.[category.value] || 0 : null;
      const pressed = filters.category === category.value;
      const btn = createEl('button', {
        type: 'button',
        class: 'filter-chip',
        'aria-pressed': pressed ? 'true' : 'false',
      }, [icon(category.icon, { size: 15 }), category.label]);
      if (n) btn.append(createEl('span', { class: 'filter-chip__count' }, formatNumber(n)));
      btn.addEventListener('click', () => {
        filters.category = filters.category === category.value ? '' : category.value;
        renderCategories();
        load({ reset: true });
      });
      categoriesEl.append(btn);
    }
  }

  function renderCount(total) {
    countEl.textContent = tn(total, '{n} member', '{n} members');
  }

  async function load({ reset = false } = {}) {
    const id = ++requestId;
    errorEl.hidden = true;
    writeFilters(filters);
    if (reset) {
      nextOffset = null;
      listEl.replaceChildren(...skeletonCards(6));
      listEl.setAttribute('aria-busy', 'true');
      moreBtn.hidden = true;
    } else {
      moreBtn.disabled = true;
    }

    try {
      const result = await api.members.list({
        search: filters.search,
        segment: filters.segment,
        category: filters.category,
        sort: filters.sort || undefined,
        offset: reset ? 0 : nextOffset,
      });
      if (id !== requestId) return; // a newer filter won
      if (reset) { listEl.innerHTML = ''; shown.clear(); }
      const showRank = filters.segment === 'top' || sortEl.value === 'level';
      for (const member of result.members) {
        if (shown.has(member.id)) continue;
        shown.add(member.id);
        listEl.append(memberCard(member, { showRank }));
      }
      if (!listEl.children.length) {
        listEl.append(emptyState({
          iconId: 'i-users-round',
          title: t('No members found'),
          text: filters.search || filters.segment || filters.category
            ? t('Try another search, group or field.')
            : t('Nobody has joined yet.'),
        }));
      }
      nextOffset = result.next_offset;
      moreBtn.hidden = nextOffset == null;
      renderCount(result.total);
    } catch (err) {
      if (id !== requestId) return;
      if (reset) listEl.innerHTML = '';
      errorEl.textContent = errorMessage(err, 'Could not load members.');
      errorEl.hidden = false;
    } finally {
      if (id === requestId) {
        listEl.setAttribute('aria-busy', 'false');
        moreBtn.disabled = false;
      }
    }
  }

  let debounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const value = searchEl.value.trim().slice(0, 60);
      if (value === filters.search) return;
      filters.search = value;
      load({ reset: true });
    }, 250);
  });
  sortEl.addEventListener('change', () => {
    filters.sort = sortEl.value === defaultSort(filters.segment) ? '' : sortEl.value;
    load({ reset: true });
  });
  moreBtn.addEventListener('click', () => load());

  renderSegments();
  renderCategories();
  load({ reset: true });

  try {
    ({ counts } = await api.members.counts());
    renderSegments();
    renderCategories();
  } catch {
    // The list works without the numbers.
  }
}
