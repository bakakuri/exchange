// js/shared/report-labels.js - report_type / report_status names
// (012_reports.sql), shared by /reports and /admin/reports.

import { t } from '../core/i18n.js';

const TYPES = {
  spam: () => t('Spam'),
  fraud: () => t('Fraud'),
  invalid_task: () => t('Invalid task'),
  inappropriate_content: () => t('Inappropriate content'),
  broken_url: () => t('Broken URL'),
  abuse: () => t('Abuse'),
};

const STATUSES = {
  open: () => t('Open'),
  resolved: () => t('Resolved'),
  dismissed: () => t('Dismissed'),
};

export const reportTypeLabel = (type) => TYPES[type]?.() || type;
export const reportStatusLabel = (status) => STATUSES[status]?.() || status;
