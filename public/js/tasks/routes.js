// js/tasks/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/tasks', {
  fragment: '/pages/tasks.html',
  module: '/js/tasks/tasks.js',
  title: 'Browse tasks · Exchange',
  protected: true,
});

registerRoute('/tasks/:id', {
  fragment: '/pages/task-detail.html',
  module: '/js/tasks/task-detail.js',
  title: 'Task · Exchange',
  protected: true,
});
