'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compose } = require('../../src/admin/views');

const PAGES = path.join(__dirname, '../../src/admin/views/pages');

function viewsDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-views-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  return root;
}

describe('dashboard view composition', () => {
  // Dropping a partial from the shell is silent: the sidebar still offers the section, and
  // choosing it renders an empty main area rather than failing.
  it('renders every page partial into the shell', () => {
    const files = fs.readdirSync(PAGES).filter((f) => f.endsWith('.html'));
    assert.ok(files.length > 3, 'found almost no page partials — this check proves nothing');

    const html = compose();
    for (const file of files) {
      const partial = fs.readFileSync(path.join(PAGES, file), 'utf8');
      assert.ok(html.includes(partial), `pages/${file} is never included by the shell`);
    }
  });

  it('leaves no include marker in what is served', () => {
    assert.doesNotMatch(compose(), /<!--#include/);
  });

  it('substitutes a partial for its whole marker line, indentation included', () => {
    const root = viewsDir({
      'index.html': '<main>\n      <!--#include pages/one.html-->\n</main>\n',
      'pages/one.html': '  <div>one</div>\n',
    });
    assert.strictEqual(compose(root), '<main>\n  <div>one</div>\n</main>\n');
  });

  it('fails loudly when the shell names a partial that is not there', () => {
    const root = viewsDir({ 'index.html': '<!--#include pages/gone.html-->\n' });
    assert.throws(() => compose(root), { code: 'ENOENT' });
  });

  // compose() being right proves nothing if the route stopped calling it. Nothing else ties the
  // view layer to the bytes the dashboard actually answers with.
  describe('the dashboard route', () => {
    let request;
    let app;

    before(() => {
      process.env.SHELLM_ADMIN_PASSWORD = 'views-test-password';
      request = require('supertest');
      app = require('../../src/server');
    });

    after(() => {
      delete process.env.SHELLM_ADMIN_PASSWORD;
    });

    it('answers with the composed page', async () => {
      const auth = `Basic ${Buffer.from('admin:views-test-password').toString('base64')}`;
      const res = await request(app).get('/admin/dashboard/').set('Authorization', auth);

      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.strictEqual(res.text, compose());
    });
  });
});
