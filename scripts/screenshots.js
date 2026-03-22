#!/usr/bin/env node

/**
 * Generate README screenshots from a running SheLLM instance.
 *
 * Usage:
 *   node scripts/screenshots.js [--base-url http://localhost:6100]
 *
 * Requires: playwright (devDependency)
 * Outputs:  docs/screenshots/landing.png
 *           docs/screenshots/dashboard-overview.png
 *           docs/screenshots/dashboard-logs.png
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'http://localhost:6100';

const ADMIN_USER = process.env.SHELLM_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SHELLM_ADMIN_PASSWORD || '';

const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };

const PAGES = [
  {
    name: 'landing',
    url: '/',
    waitFor: 'networkidle',
  },
  {
    name: 'dashboard-overview',
    url: '/admin/dashboard/#overview',
    auth: true,
    waitFor: 'networkidle',
    delay: 1500, // wait for Alpine + API data
  },
  {
    name: 'dashboard-logs',
    url: '/admin/dashboard/#logs',
    auth: true,
    waitFor: 'networkidle',
    delay: 1500,
  },
];

async function main() {
  if (!ADMIN_PASS) {
    console.error('Set SHELLM_ADMIN_PASSWORD to capture admin screenshots');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });

  for (const page of PAGES) {
    const tab = await context.newPage();

    if (page.auth) {
      // Only send auth header to our own server, not to third-party CDNs
      // (sending it to fonts.gstatic.com causes font downloads to fail)
      await tab.route('**/*', async (route, request) => {
        if (request.url().startsWith(BASE_URL)) {
          await route.continue({
            headers: {
              ...request.headers(),
              authorization: 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64'),
            },
          });
        } else {
          await route.continue();
        }
      });
    }

    const url = `${BASE_URL}${page.url}`;
    console.log(`Capturing ${page.name} → ${url}`);
    await tab.goto(url, { waitUntil: page.waitFor, timeout: 15000 });

    if (page.delay) {
      await tab.waitForTimeout(page.delay);
    }

    // Wait for web fonts (Material Symbols, etc.) to finish loading and rendering
    await tab.evaluate(async () => {
      await document.fonts.ready;
      // Check that Material Symbols font is actually available
      const maxWait = 5000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const loaded = [...document.fonts].some(f => f.family.includes('Material Symbols'));
        if (loaded) break;
        await new Promise(r => setTimeout(r, 200));
      }
    });
    // Brief pause for font rasterization after load
    await tab.waitForTimeout(500);

    const outPath = path.join(OUT_DIR, `${page.name}.png`);
    await tab.screenshot({ path: outPath, fullPage: false });
    console.log(`  → ${outPath}`);

    await tab.close();
  }

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
