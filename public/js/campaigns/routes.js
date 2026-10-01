// js/campaigns/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/campaigns', {
  fragment: '/pages/campaigns.html',
  module: '/js/campaigns/campaigns.js',
  title: 'My campaigns · Exchange',
  protected: true,
});

registerRoute('/campaigns/new', {
  fragment: '/pages/campaign-new.html',
  module: '/js/campaigns/campaign-new.js',
  title: 'New campaign · Exchange',
  protected: true,
});

// Must come after /campaigns/new, or "new" would be captured as a :id
// value - same reasoning as profile.routes.js's /me before /:username.
registerRoute('/campaigns/:id', {
  fragment: '/pages/campaign-detail.html',
  module: '/js/campaigns/campaign-detail.js',
  title: 'Campaign · Exchange',
  protected: true,
});
