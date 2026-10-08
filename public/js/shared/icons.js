// js/shared/icons.js
// Renders icons from the inline SVG sprite in index.html:
//   i-*  Lucide UI icons (ISC)       - stroke, styled by .icon in base.css
//   p-*  Simple Icons logos (CC0)    - solid fill
// Licenses: /img/ICONS-LICENSES.txt
//
// icon('i-bell')                      -> decorative <svg>
// icon('i-bell', { label: 'Alerts' }) -> announced to screen readers
// platformTile('instagram')           -> logo in a rounded tile, labelled

import { taskPlatformLabel } from './task-platforms.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(id, { size = 20, className = '', label } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// LinkedIn asked Simple Icons to remove its logo, so it gets a neutral
// briefcase; "other" gets a globe.
const PLATFORM_ICONS = {
  instagram: 'p-instagram',
  tiktok: 'p-tiktok',
  youtube: 'p-youtube',
  facebook: 'p-facebook',
  x: 'p-x',
  telegram: 'p-telegram',
  discord: 'p-discord',
  twitch: 'p-twitch',
  reddit: 'p-reddit',
  pinterest: 'p-pinterest',
  linkedin: 'i-briefcase',
  other: 'i-globe',
};

export function platformIconId(platform) {
  return PLATFORM_ICONS[platform] || 'i-globe';
}

export function platformIcon(platform, options = {}) {
  return icon(platformIconId(platform), options);
}

// A platform logo in a rounded tile - the visual anchor of task,
// campaign and submission rows.
export function platformTile(platform, { size = 'md' } = {}) {
  const tile = document.createElement('span');
  // --<platform> gives the tile that platform's own colors (base.css).
  tile.className = `platform-tile platform-tile--${size} platform-tile--${PLATFORM_ICONS[platform] ? platform : 'other'}`;
  tile.title = taskPlatformLabel(platform);
  tile.append(platformIcon(platform, { size: size === 'lg' ? 22 : 18, label: taskPlatformLabel(platform) }));
  return tile;
}

// Initials avatar (no uploads needed): "Giorgi Beridze" -> "GB".
export function avatar(name = '', { size = 'md' } = {}) {
  const el = document.createElement('span');
  el.className = `avatar avatar--${size}`;
  el.setAttribute('aria-hidden', 'true');
  const letters = String(name).trim().split(/[\s._-]+/).filter(Boolean);
  el.textContent = ((letters[0]?.[0] || '?') + (letters[1]?.[0] || '')).toUpperCase();
  return el;
}
