'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStaticFileServer } = require('../server/static');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('maintained assets use clean URLs and server revalidation', () => {
  const html = read('public/index.html');
  const manifest = read('public/manifest.webmanifest');

  assert.doesNotMatch(`${html}\n${manifest}`, /[?&](?:v|ver|version)=\d+/);
});

function requestStatic(serveFile, pathname, headers = {}) {
  return new Promise(resolve => {
    const response = {
      status: 0,
      headers: {},
      body: Buffer.alloc(0),
      writeHead(status, responseHeaders = {}) {
        this.status = status;
        this.headers = responseHeaders;
      },
      end(data = Buffer.alloc(0)) {
        this.body = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        resolve(this);
      },
    };
    serveFile({ headers }, response, pathname);
  });
}

test('static assets revalidate with content ETags', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-static-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempRoot, 'app.js'), 'export const ready = true;');
  const serveFile = createStaticFileServer({ root: tempRoot, mimeTypes: { '.js': 'application/javascript' } });

  const first = await requestStatic(serveFile, '/app.js');
  assert.equal(first.status, 200);
  assert.equal(first.headers['Cache-Control'], 'no-cache');
  assert.ok(first.headers.ETag);
  assert.equal(first.body.toString(), 'export const ready = true;');

  const second = await requestStatic(serveFile, '/app.js', { 'if-none-match': first.headers.ETag });
  assert.equal(second.status, 304);
  assert.equal(second.headers.ETag, first.headers.ETag);
  assert.equal(second.body.length, 0);
});

test('saved sessions hide login until authentication resolves', () => {
  const html = read('public/index.html');
  const css = read('public/css/style.css');
  const app = read('public/js/app.js');

  assert.match(html, /src="\/js\/app-config\.js"/);
  assert.match(html, /localStorage\.getItem\(globalThis\.FFMPEG_WEBAPP_CLIENT_CONFIG\.sessionStorageKey\)/);
  assert.match(html, /id="session-screen"[^>]*role="status"/);
  assert.match(css, /\.restoring-session #login-screen\s*\{\s*display: none/);
  assert.match(app, /document\.documentElement\.classList\.remove\('restoring-session'\)/);
  assert.match(app, /showScreen\('app'\);\s*const state = await apiFetch\('\/api\/state'\)/);
});
