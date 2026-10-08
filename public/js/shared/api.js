// js/shared/api.js
// Domain-specific API surface. Grows one namespace per stage. Every call
// goes through request() (http.js), which attaches the current session's
// bearer token automatically - nothing here handles auth headers itself.

import { request } from './http.js';

export const api = {
  health: () => request('GET', '/health'),

  auth: {
    register: (body) => request('POST', '/auth/register', { body }),
    login: (body) => request('POST', '/auth/login', { body }),
    logout: () => request('POST', '/auth/logout'),
    refresh: (refreshToken) => request('POST', '/auth/refresh', { body: { refresh_token: refreshToken } }),
    requestPasswordReset: (email) => request('POST', '/auth/password-reset/request', { body: { email } }),
    confirmPasswordReset: (accessToken, password) =>
      request('POST', '/auth/password-reset/confirm', { body: { access_token: accessToken, password } }),
    session: () => request('GET', '/auth/session'),
  },

  profile: {
    me: () => request('GET', '/profile/me'),
    update: (patch) => request('PATCH', '/profile/me', { body: patch }),
    byUsername: (username) => request('GET', `/profile/${encodeURIComponent(username)}`),
  },

  social: {
    mine: () => request('GET', '/social'),
    create: (body) => request('POST', '/social', { body }),
    update: (id, patch) => request('PATCH', `/social/${encodeURIComponent(id)}`, { body: patch }),
    remove: (id) => request('DELETE', `/social/${encodeURIComponent(id)}`),
    byUsername: (username) => request('GET', `/profile/${encodeURIComponent(username)}/social`),
  },

  credits: {
    balance: () => request('GET', '/credits/balance'),
    ledger: ({ before } = {}) => request('GET', `/credits/ledger${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    summary: () => request('GET', '/credits/summary'),
    welcomeBonus: () => request('GET', '/credits/welcome-bonus'),
  },

  tasks: {
    listOpen: ({ before, platform, taskType } = {}) => {
      const qs = new URLSearchParams();
      if (before) qs.set('before', before);
      if (platform) qs.set('platform', platform);
      if (taskType) qs.set('task_type', taskType);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/tasks${suffix}`);
    },
    get: (id) => request('GET', `/tasks/${encodeURIComponent(id)}`),
  },

  campaigns: {
    create: (body) => request('POST', '/campaigns', { body }),
    mine: ({ before, status } = {}) => {
      const qs = new URLSearchParams();
      if (before) qs.set('before', before);
      if (status) qs.set('status', status);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/campaigns/mine${suffix}`);
    },
    get: (id) => request('GET', `/campaigns/${encodeURIComponent(id)}`),
    update: (id, patch) => request('PATCH', `/campaigns/${encodeURIComponent(id)}`, { body: patch }),
    pause: (id) => request('POST', `/campaigns/${encodeURIComponent(id)}/pause`),
    resume: (id) => request('POST', `/campaigns/${encodeURIComponent(id)}/resume`),
    cancel: (id, reason) => request('POST', `/campaigns/${encodeURIComponent(id)}/cancel`, { body: { reason } }),
  },

  achievements: {
    catalog: () => request('GET', '/achievements'),
    mine: () => request('GET', '/achievements/mine'),
    byUsername: (username) => request('GET', `/achievements/${encodeURIComponent(username)}`),
  },

  notifications: {
    mine: ({ before, unread } = {}) => {
      const qs = new URLSearchParams();
      if (before) qs.set('before', before);
      if (unread) qs.set('unread', 'true');
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/notifications${suffix}`);
    },
    unreadCount: () => request('GET', '/notifications/unread-count'),
    markRead: (id) => request('PATCH', `/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: () => request('POST', '/notifications/read-all'),
  },

  activity: {
    mine: ({ before } = {}) => request('GET', `/activity/mine${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    byUsername: (username, { before } = {}) =>
      request('GET', `/activity/${encodeURIComponent(username)}${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  },

  verification: {
    submit: (taskId, body) => request('POST', `/verification/tasks/${encodeURIComponent(taskId)}`, { body }),
    review: (id, body) => request('POST', `/verification/${encodeURIComponent(id)}/review`, { body }),
    mine: ({ before, status } = {}) => request('GET', `/verification/mine${verificationQuery({ before, status })}`),
    toReview: ({ before, status } = {}) => request('GET', `/verification/to-review${verificationQuery({ before, status })}`),
    uploadProofImage: (file) => request('POST', '/verification/proof-image', { file }),
    openLink: (taskId) => request('POST', `/verification/tasks/${encodeURIComponent(taskId)}/open`, { keepalive: true }),
    completeLink: (taskId) => request('POST', `/verification/tasks/${encodeURIComponent(taskId)}/complete`),
    appeal: (id, message) => request('POST', `/verification/${encodeURIComponent(id)}/appeal`, { body: { message } }),
    reportUndone: (id, message) => request('POST', `/verification/${encodeURIComponent(id)}/report-undone`, { body: { message } }),
  },

  referrals: {
    mine: ({ before } = {}) => request('GET', `/referrals/mine${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    claim: (code) => request('POST', '/referrals/claim', { body: { code } }),
  },

  reports: {
    submit: (body) => request('POST', '/reports', { body }),
    mine: ({ before } = {}) => request('GET', `/reports/mine${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  },

  admin: {
    stats: () => request('GET', '/admin/stats'),
    users: ({ search, before, limit } = {}) => {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (before) qs.set('before', before);
      if (limit) qs.set('limit', String(limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/admin/users${suffix}`);
    },
    user: (id) => request('GET', `/admin/users/${encodeURIComponent(id)}`),
    updateUser: (id, body) => request('PATCH', `/admin/users/${encodeURIComponent(id)}`, { body }),
    adjustCredits: (id, body) => request('POST', `/admin/users/${encodeURIComponent(id)}/credits`, { body }),
    audit: ({ before } = {}) => request('GET', `/admin/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    reports: ({ status, before } = {}) => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (before) qs.set('before', before);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/admin/reports${suffix}`);
    },
    resolveReport: (id, body) => request('POST', `/admin/reports/${encodeURIComponent(id)}/resolve`, { body }),
    overturnRejection: (completionId, note) =>
      request('POST', `/admin/completions/${encodeURIComponent(completionId)}/overturn`, { body: { note } }),
    reverseReward: (completionId, note) =>
      request('POST', `/admin/completions/${encodeURIComponent(completionId)}/reverse`, { body: { note } }),
  },
};

function verificationQuery({ before, status } = {}) {
  const qs = new URLSearchParams();
  if (before) qs.set('before', before);
  if (status) qs.set('status', status);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : '';
}
