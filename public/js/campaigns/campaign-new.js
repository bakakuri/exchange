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
import { ApiError } from '../shared/errors.js';
import { TASK_PLATFORMS } from '../shared/task-platforms.js';
import { TASK_TYPES } from '../shared/task-types.js';

export async function init() {
  const form = qs('#campaign-form');
  const errorEl = qs('#campaign-error');
  const balanceHint = qs('[data-balance-hint]');
  const totalEl = qs('[data-campaign-total]');
  if (!form) return;

  for (const p of TASK_PLATFORMS) form.platform.append(new Option(p.label, p.value));
  for (const t of TASK_TYPES) form.task_type.append(new Option(t.label, t.value));

  try {
    const { balance } = await api.credits.balance();
    balanceHint.textContent = `Your balance: ${balance} credits.`;
  } catch {
    balanceHint.textContent = '';
  }

  function updateTotal() {
    const reward = Number(form.reward.value) || 0;
    const desiredCompletions = Number(form.desired_completions.value) || 0;
    totalEl.textContent = reward > 0 && desiredCompletions > 0 ? `Total budget: ${reward * desiredCompletions} credits.` : '';
  }

  form.reward.addEventListener('input', updateTotal);
  form.desired_completions.addEventListener('input', updateTotal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const { campaign } = await api.campaigns.create({
        title: form.title.value.trim(),
        description: form.description.value.trim() || undefined,
        platform: form.platform.value,
        task_type: form.task_type.value,
        target_url: form.target_url.value.trim(),
        instructions: form.instructions.value.trim() || undefined,
        verification_method: form.verification_method.value,
        reward: Number(form.reward.value),
        desired_completions: Number(form.desired_completions.value),
      });
      navigate(`/campaigns/${campaign.id}`, { replace: true });
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not create that campaign.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
}
