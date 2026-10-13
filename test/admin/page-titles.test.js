const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A tab or an installed app shows only this line, so it says what SheLLM is, not just its name.
describe('what the browser shows as the dashboard\'s name', () => {
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../src/admin', file), 'utf8');
  const PURPOSE = 'SheLLM · Your LLM subscription as a REST API';

  it('is the same line in the tab and in the installed app', () => {
    assert.match(read('views/index.html'), new RegExp(`<title>${PURPOSE}</title>`));
    assert.equal(JSON.parse(read('public/manifest.webmanifest')).name, PURPOSE);
  });

  it('keeps the short name the home screen has room for', () => {
    assert.equal(JSON.parse(read('public/manifest.webmanifest')).short_name, 'SheLLM');
  });
});
