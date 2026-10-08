// js/admin/labels.js - user_role / user_status names (001_profiles.sql).

import { t } from '../core/i18n.js';

const ROLES = { user: () => t('Member'), admin: () => t('Admin') };
const STATUSES = { active: () => t('Active'), suspended: () => t('Suspended') };

export const roleLabel = (role) => ROLES[role]?.() || role;
export const userStatusLabel = (status) => STATUSES[status]?.() || status;
