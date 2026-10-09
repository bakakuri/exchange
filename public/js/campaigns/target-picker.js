// js/campaigns/target-picker.js
// "Where should members go?" for a new campaign. Instead of typing a link,
// the creator picks one of their linked accounts; platforms they haven't
// linked are listed too, marked "Add", and can be linked right here
// (saved to their profile as well). "Other link" takes any URL and works
// out the platform from it.
//
// For actions done on one post (like, comment, share...) a picked account
// isn't enough: the picker then asks for that post's link.
//
// An accessible listbox: the button opens it, arrows / Home / End move,
// Enter or Space picks, Escape closes; it closes on a click outside.

import { api } from '../shared/api.js';
import { createEl } from '../shared/dom.js';
import { icon, platformTile } from '../shared/icons.js';
import { errorMessage } from '../shared/errors.js';
import { SOCIAL_PLATFORMS, platformLabel } from '../shared/social-platforms.js';
import { TASK_PLATFORMS } from '../shared/task-platforms.js';
import { detectPlatform, profileUrlFor, shortUrl, POST_ACTIONS } from '../shared/platform-links.js';
import { t } from '../core/i18n.js';

let pickerCount = 0;

export function createTargetPicker(root, { labelId, onChange = () => {} } = {}) {
  pickerCount += 1;
  const ids = {
    button: `target-picker-button-${pickerCount}`,
    list: `target-picker-list-${pickerCount}`,
    hint: `target-picker-hint-${pickerCount}`,
  };

  const state = {
    accounts: [],
    status: 'loading', // loading | ready | error
    choice: null, // { kind: 'account', id } | { kind: 'other' }
    adding: null, // platform being linked in the inline form
    action: 'follow',
    open: false,
    active: -1,
  };

  // ── skeleton ──────────────────────────────────────────────────────────────

  const buttonBody = createEl('span', { class: 'picker__current' });
  const button = createEl('button', {
    type: 'button',
    id: ids.button,
    class: 'picker__button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-controls': ids.list,
    'aria-labelledby': `${labelId} ${ids.button}`,
    'aria-describedby': ids.hint,
  }, [buttonBody, icon('i-chevrons-up-down', { size: 18, className: 'picker__chevron' })]);

  const list = createEl('div', {
    id: ids.list,
    class: 'picker__list',
    role: 'listbox',
    tabindex: '-1',
    'aria-labelledby': labelId,
  });
  list.hidden = true;

  const hint = createEl('p', { class: 'form-hint picker__hint', id: ids.hint });

  // "Other link": any URL; the platform is detected and can be changed.
  const otherUrl = createEl('input', {
    id: `target-other-url-${pickerCount}`, type: 'url', inputmode: 'url', placeholder: 'https://', autocomplete: 'off',
  });
  const otherPlatform = createEl('select', { id: `target-other-platform-${pickerCount}` },
    TASK_PLATFORMS.map((p) => new Option(p.label, p.value)));
  const otherBox = createEl('div', { class: 'picker-extra' }, [
    createEl('div', { class: 'field' }, [
      createEl('label', { for: otherUrl.id }, t('Link')),
      otherUrl,
    ]),
    createEl('div', { class: 'field' }, [
      createEl('label', { for: otherPlatform.id }, t('Platform')),
      otherPlatform,
      createEl('p', { class: 'form-hint', 'data-detected': '' }),
    ]),
  ]);
  otherBox.hidden = true;
  let platformTouched = false;

  // Post-level actions: the exact post on the picked account.
  const postUrl = createEl('input', {
    id: `target-post-url-${pickerCount}`, type: 'url', inputmode: 'url', placeholder: 'https://', autocomplete: 'off',
  });
  const postNote = createEl('p', { class: 'form-hint' });
  const postBox = createEl('div', { class: 'picker-extra' }, [
    createEl('div', { class: 'field' }, [
      createEl('label', { for: postUrl.id }, t('Link to the post')),
      postUrl,
      postNote,
    ]),
  ]);
  postBox.hidden = true;

  // Inline "link an account" form.
  const addBox = createEl('div', { class: 'picker-add', role: 'group' });
  addBox.hidden = true;

  root.classList.add('picker');
  root.append(button, list, hint, addBox, otherBox, postBox);

  // ── helpers ───────────────────────────────────────────────────────────────

  const selectedAccount = () =>
    state.choice?.kind === 'account' ? state.accounts.find((a) => a.id === state.choice.id) || null : null;
  const needsPost = () => POST_ACTIONS.includes(state.action);
  const linkedPlatforms = () => new Set(state.accounts.map((a) => a.platform));

  function tileFor(platform, size = 'sm') {
    return platformTile(platform, { size });
  }

  function renderButton() {
    buttonBody.innerHTML = '';
    const account = selectedAccount();
    if (account) {
      buttonBody.append(
        tileFor(account.platform),
        createEl('span', { class: 'picker__text' }, [
          createEl('span', { class: 'picker__title' }, `@${account.username.replace(/^@/, '')}`),
          createEl('span', { class: 'picker__sub' }, `${platformLabel(account.platform)} · ${shortUrl(account.profile_url)}`),
        ]),
      );
    } else if (state.choice?.kind === 'other') {
      buttonBody.append(
        tileFor('other'),
        createEl('span', { class: 'picker__text' }, [
          createEl('span', { class: 'picker__title' }, t('Other link')),
          createEl('span', { class: 'picker__sub' }, t('Any page on the web')),
        ]),
      );
    } else {
      buttonBody.append(
        createEl('span', { class: 'picker__placeholder-tile' }, [icon('i-link', { size: 18 })]),
        createEl('span', { class: 'picker__text' }, [
          createEl('span', { class: 'picker__title picker__title--muted' },
            state.status === 'loading' ? t('Loading your accounts…') : t('Choose an account or a link')),
        ]),
      );
    }
  }

  function option(value, children, { selected = false, className = '' } = {}) {
    return createEl('div', {
      role: 'option',
      id: `${ids.list}-${value.replace(/[^a-z0-9-]/gi, '-')}`,
      class: `picker__option ${className}`.trim(),
      'data-value': value,
      'aria-selected': selected ? 'true' : 'false',
    }, children);
  }

  function group(key, title, options, note) {
    const headId = `${ids.list}-group-${key}`;
    const head = createEl('div', { class: 'picker__group-title', id: headId, role: 'presentation' }, title);
    const box = createEl('div', { role: 'group', 'aria-labelledby': headId, class: 'picker__group' }, [head]);
    if (note) box.append(createEl('p', { class: 'picker__note', role: 'presentation' }, note));
    box.append(...options);
    return box;
  }

  function renderList() {
    list.innerHTML = '';
    const linked = linkedPlatforms();

    if (state.status === 'error') {
      list.append(createEl('p', { class: 'picker__note', role: 'presentation' }, t('Could not load your linked accounts.')));
    }

    if (state.accounts.length) {
      const options = state.accounts.map((a) => option(`account:${a.id}`, [
        tileFor(a.platform),
        createEl('span', { class: 'picker__text' }, [
          createEl('span', { class: 'picker__title' }, `@${a.username.replace(/^@/, '')}`),
          createEl('span', { class: 'picker__sub' }, `${platformLabel(a.platform)} · ${shortUrl(a.profile_url)}`),
        ]),
        icon('i-check', { size: 18, className: 'picker__check' }),
      ], { selected: state.choice?.kind === 'account' && state.choice.id === a.id }));
      options.push(option('add:another', [
        createEl('span', { class: 'picker__placeholder-tile' }, [icon('i-plus', { size: 18 })]),
        createEl('span', { class: 'picker__text' }, [createEl('span', { class: 'picker__title' }, t('Link another account'))]),
      ], { className: 'picker__option--quiet' }));
      list.append(group('mine', t('Your accounts'), options));
    }

    const missing = SOCIAL_PLATFORMS.filter((p) => !linked.has(p.value));
    if (missing.length) {
      const options = missing.map((p) => option(`add:${p.value}`, [
        tileFor(p.value),
        createEl('span', { class: 'picker__text' }, [createEl('span', { class: 'picker__title' }, p.label)]),
        createEl('span', { class: 'picker__badge' }, [icon('i-plus', { size: 14 }), t('Add')]),
      ], { className: 'picker__option--missing' }));
      const note = state.accounts.length || state.status === 'loading'
        ? null
        : t("You haven't linked any accounts yet. Pick a network to add yours - it takes a few seconds.");
      list.append(group('missing', state.accounts.length ? t('Not linked yet') : t('Add a network'), options, note));
    }

    list.append(group('other', t('Something else'), [
      option('other', [
        tileFor('other'),
        createEl('span', { class: 'picker__text' }, [
          createEl('span', { class: 'picker__title' }, t('Other link')),
          createEl('span', { class: 'picker__sub' }, t('A post, a website, an invite - any link')),
        ]),
        icon('i-check', { size: 18, className: 'picker__check' }),
      ], { selected: state.choice?.kind === 'other' }),
    ]));
  }

  const options = () => [...list.querySelectorAll('[role="option"]')];

  function setActive(index) {
    const all = options();
    if (!all.length) return;
    state.active = (index + all.length) % all.length;
    all.forEach((el, i) => el.classList.toggle('is-active', i === state.active));
    const el = all[state.active];
    list.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (state.open) return;
    renderList();
    state.open = true;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    const all = options();
    const current = all.findIndex((el) => el.getAttribute('aria-selected') === 'true');
    list.focus({ preventScroll: true });
    setActive(current >= 0 ? current : 0);
    document.addEventListener('pointerdown', onOutside, true);
  }

  function close({ focusButton = true } = {}) {
    if (!state.open) return;
    state.open = false;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    root.classList.remove('is-open');
    document.removeEventListener('pointerdown', onOutside, true);
    if (focusButton) button.focus({ preventScroll: true });
  }

  function onOutside(e) {
    if (!root.contains(e.target)) close({ focusButton: false });
  }

  function choose(value) {
    if (value.startsWith('account:')) {
      state.choice = { kind: 'account', id: value.slice(8) };
      state.adding = null;
    } else if (value === 'other') {
      state.choice = { kind: 'other' };
      state.adding = null;
    } else if (value.startsWith('add:')) {
      state.adding = value.slice(4);
    }
    close();
    update();
    if (value === 'other') otherUrl.focus();
    if (value.startsWith('add:')) addBox.querySelector('input')?.focus();
  }

  // ── inline "link an account" form ─────────────────────────────────────────

  function renderAddBox() {
    addBox.innerHTML = '';
    addBox.hidden = !state.adding;
    if (!state.adding) return;

    const another = state.adding === 'another';
    const firstFree = SOCIAL_PLATFORMS[0].value;
    let platform = another ? (selectedAccount()?.platform || firstFree) : state.adding;

    const titleEl = createEl('strong', { class: 'picker-add__title' });
    const platformSelect = createEl('select', { id: `target-add-platform-${pickerCount}` },
      SOCIAL_PLATFORMS.map((p) => new Option(p.label, p.value)));
    platformSelect.value = platform;
    const username = createEl('input', {
      id: `target-add-username-${pickerCount}`, type: 'text', maxlength: '100', autocomplete: 'off',
      autocapitalize: 'none', spellcheck: 'false', required: '',
    });
    const url = createEl('input', {
      id: `target-add-url-${pickerCount}`, type: 'url', inputmode: 'url', placeholder: 'https://', required: '',
    });
    const urlHint = createEl('p', { class: 'form-hint' });
    const error = createEl('p', { class: 'form-error', role: 'alert' });
    error.hidden = true;
    const save = createEl('button', { type: 'button', class: 'btn btn--primary btn--sm' }, t('Add account'));
    const cancel = createEl('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, t('Cancel'));
    let urlTouched = false;

    function refreshPlatform() {
      titleEl.replaceChildren(tileFor(platform), t('Link your {platform} account', { platform: platformLabel(platform) }));
      username.placeholder = platform === 'discord' ? t('Server or profile name') : '@username';
      urlHint.textContent = platform === 'discord'
        ? t('Paste your invite link, e.g. https://discord.gg/…')
        : t('Filled in from the username - change it if your link is different.');
      if (!urlTouched) url.value = profileUrlFor(platform, username.value);
    }

    platformSelect.addEventListener('change', () => { platform = platformSelect.value; refreshPlatform(); });
    username.addEventListener('input', () => { if (!urlTouched) url.value = profileUrlFor(platform, username.value); });
    url.addEventListener('input', () => { urlTouched = url.value.trim() !== ''; });
    cancel.addEventListener('click', () => { state.adding = null; update(); button.focus(); });
    const submitOnEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } };
    username.addEventListener('keydown', submitOnEnter);
    url.addEventListener('keydown', submitOnEnter);

    save.addEventListener('click', async () => {
      error.hidden = true;
      const handle = username.value.trim().replace(/^@+/, '');
      const link = url.value.trim();
      if (!handle) { error.textContent = t('Enter the username.'); error.hidden = false; username.focus(); return; }
      if (!/^https:\/\//.test(link)) { error.textContent = t('The profile link must start with https://'); error.hidden = false; url.focus(); return; }
      save.disabled = true;
      try {
        const { social_profile: created } = await api.social.create({ platform, username: handle, profile_url: link });
        state.accounts.push(created);
        state.choice = { kind: 'account', id: created.id };
        state.adding = null;
        update();
        hint.dataset.flash = t('{platform} account added - it is saved to your profile too.', { platform: platformLabel(platform) });
        renderHint();
        button.focus();
      } catch (err) {
        error.textContent = errorMessage(err, 'Could not add that account.');
        error.hidden = false;
        save.disabled = false;
      }
    });

    const fields = [];
    if (another) {
      fields.push(createEl('div', { class: 'field' }, [
        createEl('label', { for: platformSelect.id }, t('Platform')), platformSelect,
      ]));
    }
    fields.push(
      createEl('div', { class: 'field' }, [createEl('label', { for: username.id }, t('Username')), username]),
      createEl('div', { class: 'field' }, [createEl('label', { for: url.id }, t('Profile link')), url, urlHint]),
    );
    addBox.setAttribute('aria-label', t('Link an account'));
    addBox.append(titleEl, ...fields, error, createEl('div', { class: 'picker-add__actions' }, [save, cancel]));
    refreshPlatform();
  }

  // ── hint, extra fields ────────────────────────────────────────────────────

  function renderHint() {
    const account = selectedAccount();
    const flash = hint.dataset.flash;
    delete hint.dataset.flash;
    if (flash) { hint.textContent = flash; hint.classList.add('picker__hint--ok'); return; }
    hint.classList.remove('picker__hint--ok');
    if (account && needsPost()) {
      hint.textContent = t('Members will open the post you link below, on {platform}.', { platform: platformLabel(account.platform) });
    } else if (account) {
      hint.textContent = t('Members will go to {url}.', { url: shortUrl(account.profile_url) });
    } else if (state.choice?.kind === 'other') {
      hint.textContent = t('Paste the page members should open.');
    } else {
      hint.textContent = t('Pick one of your linked accounts, add one, or use any other link.');
    }
  }

  function renderDetected() {
    const note = otherBox.querySelector('[data-detected]');
    const detected = detectPlatform(otherUrl.value);
    if (detected && !platformTouched) otherPlatform.value = detected;
    note.textContent = detected && detected !== 'other'
      ? t('Recognised as {platform}.', { platform: platformLabel(detected) })
      : '';
  }

  function renderPostNote() {
    const account = selectedAccount();
    const detected = detectPlatform(postUrl.value);
    postNote.classList.remove('form-hint--warn');
    if (account && detected && detected !== 'other' && detected !== account.platform) {
      postNote.textContent = t('This link is not on {platform} - check it is the right post.', { platform: platformLabel(account.platform) });
      postNote.classList.add('form-hint--warn');
    } else {
      postNote.textContent = t('The exact post, video or reel members should act on.');
    }
  }

  function update() {
    // Accounts that arrive while the list is open show up in it at once.
    if (state.open) {
      const activeId = options()[state.active]?.dataset.value;
      renderList();
      const index = options().findIndex((el) => el.dataset.value === activeId);
      setActive(index >= 0 ? index : 0);
    }
    renderButton();
    renderAddBox();
    const account = selectedAccount();
    // While a new account is being linked, only that form shows.
    otherBox.hidden = state.choice?.kind !== 'other' || Boolean(state.adding);
    postBox.hidden = !(account && needsPost()) || Boolean(state.adding);
    if (!postBox.hidden) renderPostNote();
    renderHint();
    onChange();
  }

  // ── events ────────────────────────────────────────────────────────────────

  button.addEventListener('click', () => (state.open ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    const all = options();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(all.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (all[state.active]) choose(all[state.active].dataset.value);
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close({ focusButton: false });
  });
  list.addEventListener('click', (e) => {
    const el = e.target.closest('[role="option"]');
    if (el) choose(el.dataset.value);
  });
  list.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[role="option"]');
    if (el) {
      const index = options().indexOf(el);
      if (index !== state.active) setActive(index);
    }
  });
  otherUrl.addEventListener('input', () => { renderDetected(); onChange(); });
  otherPlatform.addEventListener('change', () => { platformTouched = true; onChange(); });
  postUrl.addEventListener('input', () => { renderPostNote(); onChange(); });

  // ── load ──────────────────────────────────────────────────────────────────

  async function load() {
    try {
      const { social_profiles } = await api.social.mine();
      state.accounts = social_profiles || [];
      state.status = 'ready';
      // Preselect the only account there is.
      if (state.accounts.length === 1 && !state.choice) state.choice = { kind: 'account', id: state.accounts[0].id };
    } catch {
      state.status = 'error';
    }
    update();
  }

  update();
  load();

  // ── public ────────────────────────────────────────────────────────────────

  return {
    /** Tell the picker which action was chosen (post-level ones need a post link). */
    setAction(action) {
      state.action = action;
      update();
    },
    /** The platform the campaign is for, once known (used to tailor hints). */
    platform() {
      const account = selectedAccount();
      if (account) return account.platform;
      if (state.choice?.kind === 'other') return otherPlatform.value;
      return null;
    },
    /** { platform, target_url } or { error, focus } when something is missing. */
    value() {
      const account = selectedAccount();
      if (account) {
        if (needsPost()) {
          const link = postUrl.value.trim();
          if (!/^https?:\/\//.test(link)) return { error: t('Paste the link to the post members should act on.'), focus: postUrl };
          return { platform: account.platform, target_url: link };
        }
        return { platform: account.platform, target_url: account.profile_url };
      }
      if (state.choice?.kind === 'other') {
        const link = otherUrl.value.trim();
        if (!/^https?:\/\//.test(link)) return { error: t('The link must start with http:// or https://'), focus: otherUrl };
        return { platform: otherPlatform.value, target_url: link };
      }
      return { error: t('Choose where members should go: one of your accounts or a link.'), focus: button };
    },
  };
}
