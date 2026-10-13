#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..');

function paint(svg, colors) {
  return svg.replace(/data-ink="(\w+)" (fill|stroke)="currentColor"/g, (_match, role, attribute) => {
    if (!colors[role]) throw new Error(`Unknown brand role: ${role}`);
    return `${attribute}="${colors[role]}"`;
  });
}

const contents = (svg) => svg.replace(/<svg[^>]*>|<\/svg>/g, '').trim();
const wrapper = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="SheLLM">\n${body}\n</svg>\n`;

function assets(root = ROOT) {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const css = /:root\s*\{([\s\S]*?)\}/.exec(read('src/admin/public/css/custom.css'));
  if (!css) throw new Error('The canonical CSS token block is missing');
  const tokens = Object.fromEntries([...css[1].matchAll(/--([\w-]+):\s*(#[\da-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
  const dark = {
    ink: '#ffffff', accent: tokens['primary-container'], surface: tokens.surface,
    panel: tokens['surface-container'], line: tokens['outline-variant'], muted: tokens['on-surface-variant'],
  };
  const light = { ink: tokens.surface, accent: tokens['primary-on-light'] };
  const mark = contents(read('assets/logo/mark.svg'));
  const wordmark = read('assets/logo/wordmark.svg');
  const width = Number(/viewBox="0 0 (\d+) 64"/.exec(wordmark)[1]) + 68;
  const lockup = wrapper(width, 64, `<g transform="translate(-12 -12) scale(.14)">${mark}</g>\n<g transform="translate(68 0)">${contents(wordmark)}</g>`);
  const output = new Map();
  const put = (file, value) => output.set(file, Buffer.from(value));
  const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
  const icon = (colors, fraction, background = '') => {
    const scale = (512 * fraction) / 330;
    return paint(wrapper(512, 512, `${background}<g transform="translate(256 256) scale(${scale}) translate(-277 -296)">${mark}</g>`), colors);
  };
  const logoDark = paint(lockup, dark);
  put('assets/logo/logo-dark.svg', logoDark);
  put('assets/logo/logo-light.svg', paint(lockup, light));
  put('assets/logo/logo-mono.svg', paint(lockup, { ...dark, accent: dark.ink }));
  put('src/admin/public/img/logo-dark.svg', logoDark);
  put('docs/api/logo.svg', logoDark.replace('viewBox=', 'width="132" height="32" viewBox='));
  put('assets/logo/icon-color.svg', icon(dark, .7));
  put('assets/logo/icon-dark.svg', icon({ ...dark, accent: dark.ink }, .7));
  put('assets/logo/icon-light.svg', icon({ ...light, accent: light.ink }, .7));
  const background = `<rect width="512" height="512" fill="${tokens.surface}"/>`;
  const favicon = icon(dark, .7, background);
  const maskable = icon(dark, .6, `<rect width="512" height="512" fill="${tokens['surface-shell']}"/>`);
  put('assets/favicon/favicon.svg', favicon);
  put('src/admin/public/img/favicon.svg', favicon);
  put('assets/logo/icon-maskable.svg', maskable);
  for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512]) {
    const image = png(favicon, size);
    put(`assets/favicon/favicon-${size}.png`, image);
    if ([16, 32, 180].includes(size)) put(`src/admin/public/img/favicon-${size}.png`, image);
    if ([192, 512].includes(size)) put(`src/admin/public/img/icon-${size}.png`, image);
  }
  put('src/admin/public/img/icon-512-maskable.png', png(maskable, 512));
  const social = paint(read('assets/brand/social-source.svg').replace('<g transform="translate(96 78) scale(1.5)" id="wordmark"></g>', `<g transform="translate(96 78) scale(1.5)">${contents(lockup)}</g>`), dark);
  if (social.includes('id="wordmark"')) throw new Error('The social card wordmark was not composed');
  put('assets/brand/social.svg', social);
  put('assets/brand/social.png', png(social, 1280));
  put('assets/brand/tokens.css', `:root {${css[1]}}\n`);
  return output;
}

function build({ check = false, root = ROOT } = {}) {
  const stale = [];
  for (const [file, bytes] of assets(root)) {
    const destination = path.join(root, file);
    if (check) {
      if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bytes)) stale.push(file);
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
  }
  if (stale.length) throw new Error(`Brand assets are stale: ${stale.join(', ')}. Run npm run brand:build.`);
  console.log(check ? 'Brand assets are current' : 'Brand assets generated');
}

if (require.main === module) build({ check: process.argv.includes('--check') });

module.exports = { assets, build };
