// Renders the gust icon set from SVG with Playwright's Chromium.
// Usage: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

// Three wind strokes. `pad` shrinks the glyph for maskable safe zones.
const glyph = (fg, pad = 0) => {
  const s = 1 - pad * 2;
  const t = `translate(${512 * pad} ${512 * pad}) scale(${s})`;
  return `<g transform="${t}" fill="none" stroke="${fg}" stroke-width="40" stroke-linecap="round">
    <path d="M96 196h236a52 52 0 1 0-52-52"/>
    <path d="M96 276h300a56 56 0 1 1-56 56"/>
    <path d="M96 356h150"/>
  </g>`;
};
const svg = ({ bg = '#0b0c0e', fg = '#ececea', radius = 112, pad = 0 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${bg}"/>${glyph(fg, pad)}</svg>`;

writeFileSync(new URL('icon.svg', out), svg());

const targets = [
  ['icon-192.png', 192, svg()],
  ['icon-512.png', 512, svg()],
  ['maskable-512.png', 512, svg({ radius: 0, pad: 0.14 })],
  ['apple-touch-icon.png', 180, svg({ radius: 0, pad: 0.08 })],
  ['badge-96.png', 96, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyph('#ffffff', 0.04)}</svg>`],
  ['favicon-32.png', 32, svg()],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, markup] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(new URL(name, out), buf);
  console.log('wrote', name);
}
await browser.close();
