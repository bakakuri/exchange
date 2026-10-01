// js/reports/routes.js — registers the /reports route.

import { registerRoute } from '../core/router.js';

registerRoute('/reports', {
  fragment: '/pages/reports.html',
  module: '/js/reports/reports.js',
  title: 'Reports · Exchange',
  protected: true,
});
