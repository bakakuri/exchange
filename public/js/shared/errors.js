// js/shared/errors.js
import { t, hasTranslation, currentLanguage } from '../core/i18n.js';

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Friendly text for error codes whose server message is technical (it can
// carry ids and amounts) or that every page words the same way.
const CODE_MESSAGES = {
  INSUFFICIENT_CREDITS: () => t('You don’t have enough credits for this.'),
  INSUFFICIENT_BUDGET: () => t('This campaign has run out of budget.'),
  TASK_ALREADY_COMPLETED: () => t('You have already submitted this task.'),
  SELF_TASK_FORBIDDEN: () => t('You can’t complete your own task.'),
  TASK_NOT_AVAILABLE: () => t('This task is no longer available.'),
  VERIFICATION_ALREADY_REVIEWED: () => t('This submission was already reviewed.'),
  CAMPAIGN_NOT_ACTIVE: () => t('This campaign is not active.'),
  CAMPAIGN_COMPLETED: () => t('This campaign is already completed.'),
  CAMPAIGN_CANCELLED: () => t('This campaign was cancelled.'),
  PENDING_LIMIT: () => t('Too many of your proofs are waiting for review. You can send more once some are reviewed.'),
  DUPLICATE_PROOF: () => t('This screenshot was already used as proof. Take a new one.'),
  ACCOUNT_REQUIRED: () => t('Choose the account you did this task from.'),
  RATE_LIMITED: () => t('Too many attempts. Please wait a moment and try again.'),
  TIMEOUT: () => t('The server took too long to answer. Please try again.'),
  INTERNAL: () => t('Something went wrong. Please try again.'),
  INTERNAL_ERROR: () => t('Something went wrong. Please try again.'),
  DB_ERROR: () => t('Something went wrong. Please try again.'),
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Text to show for a failed call, in the active language. Known server
 * messages are translated; validation errors joined with "; " are
 * translated part by part. Anything unknown falls back to `fallback`
 * (English source text, translated here) outside English.
 */
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!(err instanceof ApiError)) return t(fallback);
  const message = String(err.message || '');
  const parts = message.split('; ').filter(Boolean);
  if (parts.length && parts.every(hasTranslation)) return parts.map((p) => t(p)).join(' ');
  if (CODE_MESSAGES[err.code]) return CODE_MESSAGES[err.code]();
  if (currentLanguage() === 'en' && message) return capitalize(message);
  return t(fallback);
}
