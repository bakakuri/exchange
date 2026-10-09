// js/members/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/members', {
  fragment: '/pages/members.html',
  module: '/js/members/members.js',
  title: 'Members · Exchange',
  protected: true,
});
