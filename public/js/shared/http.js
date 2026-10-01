// js/shared/http.js
// Low-level fetch wrapper. Every network call in the app goes through this
// one function, so auth headers and error handling stay in one place.

import { CONFIG } from '../core/config.js';
import { store } from '../core/state.js';
import { ApiError } from './errors.js';

export async function request(method, path, { body, headers } = {}) {
  const session = store.getState().session;

  const res = await fetch(`${CONFIG.API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data?.error?.message || 'Request failed', data?.error?.code, res.status);
  }

  return data;
}
