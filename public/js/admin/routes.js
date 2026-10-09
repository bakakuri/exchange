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

// 022: every campaign, every proof, messages to members.
registerRoute('/admin/campaigns', {
  fragment: '/pages/admin-campaigns.html',
  module: '/js/admin/admin-campaigns.js',
  title: 'Admin: Campaigns · Exchange',
  protected: true,
  adminOnly: true,
});

registerRoute('/admin/submissions', {
  fragment: '/pages/admin-submissions.html',
  module: '/js/admin/admin-submissions.js',
  title: 'Admin: Submissions · Exchange',
  protected: true,
  adminOnly: true,
});

registerRoute('/admin/messages', {
  fragment: '/pages/admin-messages.html',
  module: '/js/admin/admin-messages.js',
  title: 'Admin: Messages · Exchange',
  protected: true,
  adminOnly: true,
});
