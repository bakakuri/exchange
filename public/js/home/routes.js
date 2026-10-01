// js/home/routes.js
import { registerRoute } from '../core/router.js';

registerRoute('/', {
  fragment: '/pages/home.html',
  module: '/js/home/home.js',
  title: 'Exchange',
});
