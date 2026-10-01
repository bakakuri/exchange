// js/credits/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/credits', {
  fragment: '/pages/credits.html',
  module: '/js/credits/credits.js',
  title: 'Credits · Exchange',
  protected: true,
});
