// js/referrals/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/referrals', {
  fragment: '/pages/referrals.html',
  module: '/js/referrals/referrals.js',
  title: 'Referrals · Exchange',
  protected: true,
});
