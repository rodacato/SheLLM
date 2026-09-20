'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The spec used to say streaming was not supported, on an endpoint that has streamed since
// September, and it documented nine of the eighteen routes the server answers. Nothing caught
// either, because nothing compared the two. This is that comparison.
describe('the OpenAPI spec describes the server that ships with it', () => {
  const apiDir = path.join(__dirname, '../../docs/api');
  const spec = JSON.parse(fs.readFileSync(path.join(apiDir, 'bundled.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

  // Real endpoints the spec deliberately leaves out, each with the reason it is not an API.
  const NOT_AN_API_SURFACE = new Map([
    ['GET /admin/dashboard/', 'the dashboard page itself, HTML'],
    ['GET /admin/login', 'the sign-in form, HTML'],
    ['POST /admin/login', 'the browser session; scripts use HTTP Basic'],
    ['POST /admin/logout', 'the browser session; scripts use HTTP Basic'],
    ['GET /admin/manifest.webmanifest', 'PWA manifest'],
    ['GET /admin/sw.js', 'PWA service worker'],
  ]);

  let request;
  let app;

  before(() => {
    process.env.SHELLM_ADMIN_PASSWORD = 'spec-coverage-password';
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
  });

  // Express 5 does not expose a mounted router's prefix, so the admin routers are read from their
  // own modules and prefixed with the one mount point src/app.js gives them.
  function routesOf(router, prefix) {
    const found = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        found.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      }
    }
    return found;
  }

  function serverRoutes() {
    const adminRouters = ['login', 'keys', 'logs', 'stats', 'providers', 'update'];
    const mounted = adminRouters.flatMap((name) => routesOf(require(`../../src/admin/${name}`), '/admin'));
    return [...routesOf(app.router, ''), ...mounted];
  }

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  function specOperations() {
    const ops = new Set();
    for (const [route, item] of Object.entries(spec.paths)) {
      // The spec writes a path parameter as {id}; Express writes it as :id.
      const expressPath = route.replace(/\{(\w+)\}/g, ':$1');
      for (const method of Object.keys(item)) {
        if (HTTP_METHODS.includes(method)) ops.add(`${method.toUpperCase()} ${expressPath}`);
      }
    }
    return ops;
  }

  it('every route the app serves has a path in the bundled spec', () => {
    const documented = specOperations();
    const undocumented = serverRoutes()
      .filter((route) => !documented.has(route))
      .filter((route) => !NOT_AN_API_SURFACE.has(route));

    assert.deepEqual(undocumented, [], `add these to docs/api/, or to NOT_AN_API_SURFACE with a reason:\n${undocumented.join('\n')}`);
  });

  it('every path in the spec is a route the app answers', () => {
    const real = new Set(serverRoutes());
    const invented = [...specOperations()].filter((route) => !real.has(route));

    assert.deepEqual(invented, [], `the spec describes endpoints that do not exist:\n${invented.join('\n')}`);
  });

  it('both request schemas document stream, and nothing claims it is unsupported', () => {
    for (const name of ['ChatCompletionRequest', 'MessagesRequest']) {
      const stream = spec.components.schemas[name].properties.stream;
      assert.ok(stream, `${name} does not document stream`);
      assert.equal(stream.type, 'boolean', `${name}.stream is not a plain boolean`);
      assert.ok(!stream.enum, `${name}.stream still restricts the value`);
    }

    for (const dir of ['paths', 'schemas']) {
      for (const file of fs.readdirSync(path.join(apiDir, dir))) {
        const text = fs.readFileSync(path.join(apiDir, dir, file), 'utf8');
        assert.doesNotMatch(text, /streaming (is )?not supported/i, `${dir}/${file} still denies streaming`);
      }
    }
  });

  it('info.version matches package.json', () => {
    assert.equal(spec.info.version, pkg.version);
  });

  it('GET /docs/openapi.json serves the bundled spec and the rest of docs/ is not served', async () => {
    const served = await request(app).get('/docs/openapi.json').expect(200);
    assert.equal(served.body.info.title, spec.info.title);
    assert.deepEqual(Object.keys(served.body.paths), Object.keys(spec.paths));

    await request(app).get('/docs/IDENTITY.md').expect(404);
    await request(app).get('/docs/api/openapi.yaml').expect(404);
  });
});
