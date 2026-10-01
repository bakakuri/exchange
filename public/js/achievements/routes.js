// js/achievements/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/achievements', {
  fragment: '/pages/achievements.html',
  module: '/js/achievements/achievements.js',
  title: 'Achievements · Exchange',
  protected: true,
});
