// js/messages/routes.js
import { registerRoute } from '../core/router.js';

// One page module for both: the inbox stays put while chats change.
registerRoute('/messages', {
  fragment: '/pages/messages.html',
  module: '/js/messages/messages.js',
  title: 'Messages · Exchange',
  protected: true,
});

registerRoute('/messages/:id', {
  fragment: '/pages/messages.html',
  module: '/js/messages/messages.js',
  title: 'Messages · Exchange',
  protected: true,
});
