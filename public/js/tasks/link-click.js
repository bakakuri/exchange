// js/tasks/link-click.js
// Visit / View / Listen tasks checked by a link click (020_verification_
// upgrades.sql): 1. open the page through Exchange - the click is
// recorded; 2. keep it open 15 seconds - the countdown runs here, the
// database enforces it; 3. claim the reward, paid at once.

import { api } from '../shared/api.js';
import { createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { t, tn } from '../core/i18n.js';
import { celebrate } from '../shared/motion.js';

function step(n, title, text) {
  return createEl('li', { class: 'visit-step' }, [
    createEl('span', { class: 'visit-step__num' }, String(n)),
    createEl('div', { class: 'visit-step__body' }, [createEl('strong', {}, title), createEl('p', {}, text)]),
  ]);
}

export function renderLinkClick(task, openLabel, onDone) {
  const wait = 15;
  const steps = [
    step(1, t('Open the page'), t('Use the button below, so Exchange can see the visit.')),
    step(2, t('Keep it open for {seconds} seconds', { seconds: wait }), t('Look around the page; the timer runs here.')),
    step(3, t('Claim your reward'), t('Credits arrive at once - nobody needs to review it.')),
  ];
  steps[0].classList.add('is-current');

  const bar = createEl('span', { class: 'progress__bar', style: 'width: 0%' });
  const progress = createEl('span', { class: 'progress visit-card__progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(wait), 'aria-valuenow': '0', hidden: '' }, [bar]);
  const timer = createEl('p', { class: 'visit-card__timer', 'aria-live': 'polite' }, '');

  const openBtn = createEl('a', {
    href: task.target_url, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn--primary btn--lg',
  }, [icon('i-external-link', { size: 18 }), openLabel]);
  const claimBtn = createEl('button', { type: 'button', class: 'btn btn--primary btn--lg', hidden: '' },
    [icon('i-coins', { size: 18 }), tn(task.campaign.reward, 'Claim {n} credit', 'Claim {n} credits')]);
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');

  let ticker = null;

  function countdown(endsAt) {
    clearInterval(ticker);
    progress.hidden = false;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const done = wait - left;
      bar.style.width = `${Math.round((done / wait) * 100)}%`;
      progress.setAttribute('aria-valuenow', String(done));
      if (left > 0) {
        timer.textContent = tn(left, '{n} second left', '{n} seconds left');
        return;
      }
      clearInterval(ticker);
      timer.textContent = t('Done - claim your reward.');
      steps[1].classList.replace('is-current', 'is-done');
      steps[2].classList.add('is-current');
      claimBtn.hidden = false;
      claimBtn.focus();
    };
    tick();
    ticker = setInterval(tick, 250);
  }

  // The link opens normally (a new tab); the click is recorded alongside.
  openBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    try {
      const { clicked_at: clickedAt, server_time: serverTime, wait_seconds: seconds } = await api.verification.openLink(task.id);
      // Server clock decides; adjust for this device's clock offset.
      const offset = Date.now() - new Date(serverTime).getTime();
      const endsAt = new Date(clickedAt).getTime() + (seconds || wait) * 1000 + offset;
      steps[0].classList.replace('is-current', 'is-done');
      steps[1].classList.add('is-current');
      openBtn.classList.replace('btn--primary', 'btn--ghost');
      countdown(endsAt);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not start this task. Try again.');
      errorEl.hidden = false;
    }
  });

  claimBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    claimBtn.disabled = true;
    try {
      const { completion } = await api.verification.completeLink(task.id);
      clearInterval(ticker);
      celebrate(claimBtn);
      onDone(completion);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not claim the reward. Try again.');
      errorEl.hidden = false;
      claimBtn.disabled = false;
    }
  });

  return createEl('section', { class: 'visit-card', 'aria-labelledby': 'visit-card-title' }, [
    createEl('div', { class: 'visit-card__head' }, [
      createEl('span', { class: 'row-icon' }, [icon('i-mouse-pointer-click', { size: 18 })]),
      createEl('div', {}, [
        createEl('h2', { id: 'visit-card-title' }, t('Checked automatically')),
        createEl('p', {}, t('No screenshot, no waiting for review.')),
      ]),
    ]),
    createEl('ol', { class: 'visit-steps' }, steps),
    progress,
    timer,
    createEl('div', { class: 'visit-card__actions' }, [openBtn, claimBtn]),
    errorEl,
  ]);
}
