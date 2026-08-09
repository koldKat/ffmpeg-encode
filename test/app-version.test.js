const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readVersionFile, writeVersionFileAtomic } = require('../server/app-version');

test('writes and reads the exact manually supplied version', async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-version-'));
  const filePath = path.join(dir, 'VERSION');
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  writeVersionFileAtomic('0.2.8.0 α', filePath);

  assert.equal(readVersionFile(filePath), '0.2.8.0 α');
  assert.equal(await fs.promises.readFile(filePath, 'utf8'), '0.2.8.0 α\n');
});

test('returns an empty value when the version file does not exist', () => {
  assert.equal(readVersionFile(path.join(os.tmpdir(), `missing-version-${process.pid}`)), '');
});
