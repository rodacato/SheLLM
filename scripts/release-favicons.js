#!/usr/bin/env node
// Generates PNG favicons from assets/favicon/favicon.svg using sharp.
// Usage: node scripts/release-favicons.js

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SVG = join(ROOT, 'assets/favicon/favicon.svg');
const OUT = join(ROOT, 'assets/favicon');

const sizes = [16, 32, 48, 64, 128, 180, 192, 256, 512];

const svg = readFileSync(SVG);

await Promise.all(
  sizes.map(async (size) => {
    const file = join(OUT, `favicon-${size}.png`);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(file);
    console.log(`✓ favicon-${size}.png`);
  })
);

console.log(`\nDone — ${sizes.length} files written to assets/favicon/`);
