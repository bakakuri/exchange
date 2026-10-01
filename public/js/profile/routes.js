// js/profile/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/profile', {
  fragment: '/pages/profile-edit.html',
  module: '/js/profile/profile-edit.js',
  title: 'Your profile · Exchange',
  protected: true,
});

registerRoute('/u/:username', {
  fragment: '/pages/profile-view.html',
  module: '/js/profile/profile-view.js',
  title: 'Profile · Exchange',
  protected: true,
});
