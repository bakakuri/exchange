// js/submissions/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/submissions', {
  fragment: '/pages/submissions.html',
  module: '/js/submissions/submissions.js',
  title: 'My submissions · Exchange',
  protected: true,
});

registerRoute('/submissions/review', {
  fragment: '/pages/review-queue.html',
  module: '/js/submissions/review-queue.js',
  title: 'Review queue · Exchange',
  protected: true,
});
