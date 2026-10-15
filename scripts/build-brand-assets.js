#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..');
// Brand sources and their committed exports. Runtime copies (dashboard img/, API reference) are
// written to where the build serves them; the Pages workflow copies these folders into site/.
const BRAND = 'design/brand';
// The portable kit is generated on demand and never committed (.gitignore).
const KIT = `${BRAND}/dist/brand-kit`;

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
  const mark = contents(read(`${BRAND}/logo/mark.svg`));
  const wordmark = read(`${BRAND}/logo/wordmark.svg`);
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
  put(`${BRAND}/logo/logo-dark.svg`, logoDark);
  put(`${BRAND}/logo/logo-light.svg`, paint(lockup, light));
  put(`${BRAND}/logo/logo-mono.svg`, paint(lockup, { ...dark, accent: dark.ink }));
  put('src/admin/public/img/logo-dark.svg', logoDark);
  put('docs/api/logo.svg', logoDark.replace('viewBox=', 'width="132" height="32" viewBox='));
  put(`${BRAND}/logo/icon-color.svg`, icon(dark, .7));
  put(`${BRAND}/logo/icon-dark.svg`, icon({ ...dark, accent: dark.ink }, .7));
  put(`${BRAND}/logo/icon-light.svg`, icon({ ...light, accent: light.ink }, .7));
  const background = `<rect width="512" height="512" fill="${tokens.surface}"/>`;
  const favicon = icon(dark, .7, background);
  const maskable = icon(dark, .6, `<rect width="512" height="512" fill="${tokens['surface-shell']}"/>`);
  put(`${BRAND}/favicon/favicon.svg`, favicon);
  put('src/admin/public/img/favicon.svg', favicon);
  put(`${BRAND}/logo/icon-maskable.svg`, maskable);
  for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512]) {
    const image = png(favicon, size);
    put(`${BRAND}/favicon/favicon-${size}.png`, image);
    if ([16, 32, 180].includes(size)) put(`src/admin/public/img/favicon-${size}.png`, image);
    if ([192, 512].includes(size)) put(`src/admin/public/img/icon-${size}.png`, image);
  }
  put('src/admin/public/img/icon-512-maskable.png', png(maskable, 512));
  const social = paint(read(`${BRAND}/social/social-source.svg`).replace('<g transform="translate(96 78) scale(1.5)" id="wordmark"></g>', `<g transform="translate(96 78) scale(1.5)">${contents(lockup)}</g>`), dark);
  if (social.includes('id="wordmark"')) throw new Error('The social card wordmark was not composed');
  put(`${BRAND}/social/social.svg`, social);
  put(`${BRAND}/social/social.png`, png(social, 1280));
  put(`${BRAND}/tokens.css`, `:root {${css[1]}}\n`);
  return output;
}

// Where a brand file is published: the same assets/ layout the Pages workflow assembles in site/,
// so the guide and landing pages keep their relative links inside the kit.
function published(file) {
  const relative = file.slice(BRAND.length + 1);
  if (relative === 'tokens.css') return 'assets/brand/tokens.css';
  if (relative.startsWith('social/')) return `assets/brand/${relative.slice('social/'.length)}`;
  return `assets/${relative}`;
}

// The portable kit: identity exports, editable sources, guide and landing, with paths relative to
// the kit folder. Generated on demand into design/brand/dist/ (gitignored), never committed.
function kitAssets(root = ROOT, generated = assets(root)) {
  const read = (file) => fs.readFileSync(path.join(root, file));
  const output = new Map();
  const put = (file, value) => output.set(file, Buffer.from(value));
  for (const [file, bytes] of generated) {
    if (file.startsWith(`${BRAND}/`)) put(published(file), bytes);
  }
  put('assets/favicon/icon-512-maskable.png', generated.get('src/admin/public/img/icon-512-maskable.png'));
  for (const file of [`${BRAND}/logo/mark.svg`, `${BRAND}/logo/wordmark.svg`, `${BRAND}/social/social-source.svg`]) {
    put(published(file), read(file));
  }
  put('README.md', read(`${BRAND}/kit/README.md`));
  put('LICENSE', read('LICENSE'));
  for (const file of fs.readdirSync(path.join(root, 'assets/site')).sort()) {
    const source = read(`assets/site/${file}`);
    put(`assets/site/${file}`, file.endsWith('.md')
      ? source.toString()
        .replaceAll('](../../design/exports/)', '](https://github.com/rodacato/SheLLM/tree/master/design/exports/)')
        .replaceAll('`design/brand/social/`', '`assets/brand/`')
      : source);
  }
  put('guide/brand.css', read('site/brand/brand.css'));
  put('guide/index.html', read('site/brand/index.html').toString()
    .replaceAll('href="../"', 'href="../marketing/"')
    .replaceAll('href="../#', 'href="../marketing/#'));
  put('marketing/index.html', read('site/index.html').toString()
    .replaceAll('href="assets/', 'href="../assets/')
    .replaceAll('src="assets/', 'src="../assets/')
    .replaceAll('src="img/', 'src="../assets/site/')
    .replaceAll('href="api/"', 'href="https://rodacato.github.io/SheLLM/api/"')
    .replaceAll('href="brand/"', 'href="../guide/"')
    .replaceAll(' · __VERSION__', ''));
  for (const file of ['inspector.js', 'inspector.json']) put(`marketing/${file}`, read(`site/${file}`));
  return output;
}

function buildKit({ root = ROOT } = {}) {
  const kit = kitAssets(root);
  const destination = path.join(root, KIT);
  fs.rmSync(destination, { recursive: true, force: true });
  for (const [file, bytes] of kit) {
    fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
    fs.writeFileSync(path.join(destination, file), bytes);
  }
  console.log(`Brand kit generated in ${KIT}`);
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

if (require.main === module) {
  if (process.argv.includes('--kit')) buildKit();
  else build({ check: process.argv.includes('--check') });
}

module.exports = { BRAND, KIT, assets, kitAssets, buildKit, build };
