// js/campaigns/campaign-new.js - behavior for the /campaigns/new route:
// create a campaign. The balance hint and live total shown here are
// purely informational - create_campaign() (015_functions.sql) is what
// actually checks and reserves the budget atomically, and is the only
// thing this form trusts for whether the campaign can really be
// afforded; a stale or manipulated client-side number changes nothing
// about what the database will accept.

import { api } from '../shared/api.js';
import { navigate } from '../core/router.js';
import { qs } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { TASK_TYPES } from '../shared/task-types.js';
import { t, tn } from '../core/i18n.js';
import { createTargetPicker } from './target-picker.js';

const LINK_CLICK_TASK_TYPES = ['visit', 'view', 'listen'];

export async function init() {
  const form = qs('#campaign-form');
  const errorEl = qs('#campaign-error');
  const balanceHint = qs('[data-balance-hint]');
  const totalEl = qs('[data-campaign-total]');
  if (!form) return;

  for (const type of TASK_TYPES) form.task_type.append(new Option(type.label, type.value));

  // Where members go: a linked account (or one linked right here), or any
  // other link. Post-level actions also need the post's link.
  const picker = createTargetPicker(qs('[data-target-picker]'), { labelId: 'campaign-target-label' });
  picker.setAction(form.task_type.value);
  form.task_type.addEventListener('change', () => picker.setAction(form.task_type.value));

  try {
    // GET /api/credits/balance responds { credits } (credit.controller.js).
    const { credits } = await api.credits.balance();
    balanceHint.textContent = t('Your balance: {amount}.', { amount: tn(credits, '{n} credit', '{n} credits') });
  } catch {
    balanceHint.textContent = '';
  }

  function updateTotal() {
    const reward = Number(form.reward.value) || 0;
    const desiredCompletions = Number(form.desired_completions.value) || 0;
    totalEl.textContent = reward > 0 && desiredCompletions > 0
      ? t('Total budget: {amount}.', { amount: tn(reward * desiredCompletions, '{n} credit', '{n} credits') })
      : '';
  }

  // A click can prove a visit, never a follow or a like - link-click
  // checking is offered only for Visit / View / Listen tasks (the server
  // and the database enforce the same rule).
  const hint = qs('[data-verification-hint]');
  const linkOption = form.verification_method.querySelector('option[value="link_click"]');
  function updateVerification() {
    const clickable = LINK_CLICK_TASK_TYPES.includes(form.task_type.value);
    linkOption.disabled = !clickable;
    if (!clickable && form.verification_method.value === 'link_click') form.verification_method.value = 'manual_proof';
    hint.textContent = form.verification_method.value === 'link_click'
      ? t('Members open the page through Exchange and get the reward after 15 seconds - no review needed.')
      : clickable
        ? t('You check each proof yourself. Unreviewed proof is approved automatically after 24 hours.')
        : t('You check each proof yourself. Unreviewed proof is approved automatically after 24 hours. Link click is only for Visit, View and Listen tasks.');
  }
  form.task_type.addEventListener('change', updateVerification);
  form.verification_method.addEventListener('change', updateVerification);
  updateVerification();

  form.reward.addEventListener('input', updateTotal);
  form.desired_completions.addEventListener('input', updateTotal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const target = picker.value();
    if (target.error) {
      errorEl.textContent = target.error;
      errorEl.hidden = false;
      target.focus?.focus();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const { campaign } = await api.campaigns.create({
        title: form.title.value.trim(),
        description: form.description.value.trim() || undefined,
        platform: target.platform,
        task_type: form.task_type.value,
        target_url: target.target_url,
        instructions: form.instructions.value.trim() || undefined,
        verification_method: form.verification_method.value,
        reward: Number(form.reward.value),
        desired_completions: Number(form.desired_completions.value),
      });
      navigate(`/campaigns/${campaign.id}`, { replace: true });
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not create that campaign.');
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
}
