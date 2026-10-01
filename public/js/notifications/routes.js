// js/notifications/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/notifications', {
  fragment: '/pages/notifications.html',
  module: '/js/notifications/notifications.js',
  title: 'Notifications · Exchange',
  protected: true,
});
