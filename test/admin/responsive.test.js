'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '../../src/admin/views');
const PAGES = path.join(VIEWS, 'pages');
const shell = () => fs.readFileSync(path.join(VIEWS, 'index.html'), 'utf8');

// Measured at 390px wide: without these the widest table set the width of the whole page and the
// installed app scrolled sideways on a phone.
describe('the dashboard fits a phone', () => {
  it('lets the content column shrink below its widest child', () => {
    const html = shell();
    assert.match(html, /<div class="md:ml-64 flex-1 min-w-0 /, 'the column beside the sidebar grows to its widest table');
    assert.match(html, /<main class="flex-1 min-w-0 /, 'main grows to its widest table');
  });

  for (const file of fs.readdirSync(PAGES)) {
    it(`${file} scrolls each table inside its own card`, () => {
      const html = fs.readFileSync(path.join(PAGES, file), 'utf8');
      let at = html.indexOf('<table');
      while (at !== -1) {
        const opener = html.lastIndexOf('<div', at);
        assert.match(html.slice(opener, html.indexOf('>', opener)), /overflow-x-auto/,
          `a table at offset ${at} is not wrapped in an overflow-x-auto container`);
        at = html.indexOf('<table', at + 1);
      }
    });
  }

  it('closes the drawer with Escape, since the open drawer covers its own toggle', () => {
    assert.match(shell(), /@keydown\.escape\.window="sidebarOpen = false"/);
  });
});
