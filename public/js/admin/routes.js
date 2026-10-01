// js/admin/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/admin', {
  fragment: '/pages/admin.html',
  module: '/js/admin/admin.js',
  title: 'Admin · Exchange',
  protected: true,
  adminOnly: true,
});

registerRoute('/admin/users/:id', {
  fragment: '/pages/admin-user.html',
  module: '/js/admin/admin-user.js',
  title: 'Admin: User · Exchange',
  protected: true,
  adminOnly: true,
});

registerRoute('/admin/reports', {
  fragment: '/pages/admin-reports.html',
  module: '/js/admin/admin-reports.js',
  title: 'Admin: Reports · Exchange',
  protected: true,
  adminOnly: true,
});
