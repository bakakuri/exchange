// js/core/language-menu.js
// The 🌐 language switcher. index.html has one in the top bar and one in
// the sidebar head ([data-lang-menu]); this fills in their lists and runs
// them as menu buttons: click or Enter opens, arrow keys move, Escape or
// a click elsewhere closes. Picking a language remembers it on this
// device and saves it to the signed-in account (core/language.js).

import { LANGUAGES, currentLanguage, languageInfo, t } from './i18n.js';
import { setLanguage } from './language.js';
import { eventBus } from './events.js';
import { createEl, qsa } from '../shared/dom.js';
import { icon } from '../shared/icons.js';

const menus = () => qsa('[data-lang-menu]');
const items = (menu) => [...menu.querySelectorAll('[role="menuitemradio"]')];

function build(menu) {
  const list = menu.querySelector('.lang-menu__list');
  list.innerHTML = '';
  for (const lang of LANGUAGES) {
    list.append(createEl('li', { role: 'none' }, [
      createEl('button', {
        type: 'button',
        class: 'lang-menu__item',
        role: 'menuitemradio',
        'aria-checked': 'false',
        tabindex: '-1',
        lang: lang.code,
        'data-lang': lang.code,
      }, [
        icon('i-check', { size: 16, className: 'lang-menu__check' }),
        createEl('span', { class: 'lang-menu__name' }, lang.name),
        createEl('span', { class: 'lang-menu__short' }, lang.short),
      ]),
    ]));
  }
}

function sync() {
  const info = languageInfo(currentLanguage());
  for (const menu of menus()) {
    menu.querySelector('[data-lang-code]').textContent = info.short;
    menu.querySelector('.lang-menu__button').setAttribute('aria-label', t('Language: {name}', { name: info.name }));
    menu.querySelector('.lang-menu__list').setAttribute('aria-label', t('Language'));
    for (const item of items(menu)) item.setAttribute('aria-checked', String(item.dataset.lang === info.code));
  }
}

function open(menu, { focus = 'current' } = {}) {
  closeAll(menu);
  const button = menu.querySelector('.lang-menu__button');
  const list = menu.querySelector('.lang-menu__list');
  list.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  menu.classList.add('is-open');
  const all = items(menu);
  const target = focus === 'last' ? all.at(-1)
    : focus === 'first' ? all[0]
      : all.find((i) => i.getAttribute('aria-checked') === 'true') || all[0];
  target?.focus();
}

function close(menu, { returnFocus = false } = {}) {
  const list = menu.querySelector('.lang-menu__list');
  if (list.hidden) return;
  list.hidden = true;
  menu.classList.remove('is-open');
  const button = menu.querySelector('.lang-menu__button');
  button.setAttribute('aria-expanded', 'false');
  if (returnFocus) button.focus();
}

function closeAll(except) {
  for (const menu of menus()) if (menu !== except) close(menu);
}

function choose(menu, code) {
  close(menu, { returnFocus: true });
  setLanguage(code, { remember: true, syncAccount: true });
}

function onKeydown(menu, e) {
  const all = items(menu);
  const index = all.indexOf(document.activeElement);
  const inList = index !== -1;
  const move = (i) => { e.preventDefault(); all[(i + all.length) % all.length].focus(); };

  if (!inList) {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(menu, { focus: 'first' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); open(menu, { focus: 'last' }); }
    return;
  }
  switch (e.key) {
    case 'ArrowDown': move(index + 1); break;
    case 'ArrowUp': move(index - 1); break;
    case 'Home': move(0); break;
    case 'End': move(all.length - 1); break;
    case 'Escape': e.preventDefault(); close(menu, { returnFocus: true }); break;
    case 'Tab': close(menu); break;
    default: break;
  }
}

export function initLanguageMenu() {
  for (const menu of menus()) {
    build(menu);
    menu.querySelector('.lang-menu__button').addEventListener('click', () => {
      if (menu.classList.contains('is-open')) close(menu);
      else open(menu);
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-lang]');
      if (item) choose(menu, item.dataset.lang);
    });
    menu.addEventListener('keydown', (e) => onKeydown(menu, e));
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-lang-menu]')) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });

  sync();
  eventBus.on('language:change', sync);
}
