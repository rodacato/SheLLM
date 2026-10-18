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

// D78: on a phone a Logs or Keys row is a card laid out on a grid. A cell with no place of its own
// lands wherever auto-placement puts it, which reads as a value under the wrong neighbour.
describe('Logs and Keys rows stack into cards on a phone', () => {
  const page = (file) => fs.readFileSync(path.join(PAGES, file), 'utf8');
  const cellsOf = (row) => row.match(/<td\b[^>]*>/g) || [];

  const rows = {
    'logs.html': [/<tr @click="toggleRow\(log\.id\)"[\s\S]*?<\/tr>/, /<template x-for="job in shownInFlight"[\s\S]*?<\/tr>/],
    'keys.html': [/<template x-for="key in keys"[\s\S]*?<\/tr>/],
  };

  for (const [file, patterns] of Object.entries(rows)) {
    it(`${file} hides the header row and turns each data row into a grid`, () => {
      const html = page(file);
      assert.match(html, /<thead class="[^"]*max-md:hidden/, 'the column headers float above cards they no longer label');
      for (const pattern of patterns) {
        const row = pattern.exec(html)[0];
        assert.match(row, /<tr[^>]*class="[^"]*max-md:grid /, 'the row is still a table row on a phone');
      }
    });

    it(`${file} gives every cell of a card a place, or takes it out`, () => {
      for (const pattern of patterns) {
        const row = pattern.exec(page(file))[0];
        const cells = cellsOf(row);
        assert.ok(cells.length >= 8, `found ${cells.length} cells; the pattern no longer matches the row`);
        for (const cell of cells) {
          assert.match(cell, /max-md:hidden|max-md:col-start-\d[^"]*max-md:row-start-\d/, `a cell has no place on the card: ${cell}`);
        }
      }
    });
  }

});
