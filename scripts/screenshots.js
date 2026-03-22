#!/usr/bin/env node

/**
 * Generate README screenshots from a running SheLLM instance.
 *
 * Usage:
 *   node scripts/screenshots.js [--base-url http://localhost:6100]
 *
 * Requires: puppeteer (devDependency)
 * Outputs:  docs/screenshots/landing.png
 *           docs/screenshots/dashboard-overview.png
 *           docs/screenshots/dashboard-logs.png
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'http://localhost:6100';

const ADMIN_USER = process.env.SHELLM_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SHELLM_ADMIN_PASSWORD || '';

const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const PAGES = [
  {
    name: 'landing',
    url: '/',
    waitFor: 'networkidle0',
  },
  {
    name: 'dashboard-overview',
    url: '/admin/dashboard/#overview',
    auth: true,
    waitFor: 'networkidle0',
    delay: 1500, // wait for Alpine + API data
  },
  {
    name: 'dashboard-logs',
    url: '/admin/dashboard/#logs',
    auth: true,
    waitFor: 'networkidle0',
    delay: 1500,
  },
];

async function main() {
  if (!ADMIN_PASS) {
    console.error('Set SHELLM_ADMIN_PASSWORD to capture admin screenshots');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const page of PAGES) {
    const tab = await browser.newPage();
    await tab.setViewport(VIEWPORT);

    const url = `${BASE_URL}${page.url}`;
    const options = { waitUntil: page.waitFor, timeout: 15000 };

    if (page.auth) {
      await tab.setExtraHTTPHeaders({
        Authorization: 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64'),
      });
    }

    console.log(`Capturing ${page.name} → ${url}`);
    await tab.goto(url, options);

    if (page.delay) {
      await new Promise((r) => setTimeout(r, page.delay));
    }

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
