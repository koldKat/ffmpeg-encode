const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeEncoder } = require('../server/encoding-options');
const { createQueueModel } = require('../server/queue-model');
const { normalizeAudioTrack } = createQueueModel({});
const { APP_CONFIG } = require('../server/app-config');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const context = { normalizeEncoder, normalizeAudioTrack };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function buildFfmpegArgs('), source.indexOf('function runFfmpegPass(')), context);
const build = (pass, encoder = 'x265') => Array.from(context.buildFfmpegArgs({
  inputPath: '/input.mkv', stagePath: '/output.mp4', vbKbps: 1000,
  config: { ...APP_CONFIG.encodingDefaults, encoder }, pass, passlog: '/tmp/unique-pass', audioTrack: 1,
}));

test('both passes use Main10 HEVC, dark-scene AQ and the same private stats file', () => {
  for (const pass of [1, 2]) {
    const args = build(pass);
    const value = flag => args[args.indexOf(flag) + 1];
    assert.equal(value('-c:v'), 'libx265');
    assert.equal(value('-profile:v'), 'main10');
    assert.equal(value('-pix_fmt'), 'yuv420p10le');
    assert.equal(value('-tag:v'), 'hvc1');
    assert.equal(value('-b:v'), '1000k');
    assert.equal(value('-x265-params'), `pass=${pass}:stats=/tmp/unique-pass:aq-mode=3`);
    assert.ok(!args.includes('-pass'));
    assert.ok(!args.includes('-tune'));
    assert.ok(!args.includes('-level'));
    assert.equal(args.includes('0:a:1?'), pass === 2);
    assert.equal(args.includes('/output.mp4'), pass === 2);
  }
});

test('encoder selection normalizes supported choices and defaults old or invalid values to x265', () => {
  for (const value of ['film', 'animation', '', undefined, 'invalid']) assert.equal(normalizeEncoder(value), 'x265');
  assert.equal(normalizeEncoder('x264'), 'x264');
  assert.equal(normalizeEncoder(' X264 '), 'x264');
  assert.equal(normalizeEncoder('x265'), 'x265');
});

test('x264 uses H.264-compatible output and its own two-pass flags without tune', () => {
  for (const pass of [1, 2]) {
    const args = build(pass, 'x264');
    const value = flag => args[args.indexOf(flag) + 1];
    assert.equal(value('-c:v'), 'libx264');
    assert.equal(value('-profile:v'), 'high');
    assert.equal(value('-pix_fmt'), 'yuv420p');
    assert.equal(value('-tag:v'), 'avc1');
    assert.equal(value('-pass'), String(pass));
    assert.equal(value('-passlogfile'), '/tmp/unique-pass');
    assert.ok(!args.includes('-x265-params'));
    assert.ok(!args.includes('-tune'));
  }
});

test('x265 statistics and temporary files are removed alongside legacy pass logs', async () => {
  const removed = [];
  const scope = { removeIfExists: async path => removed.push(path) };
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('async function cleanupPasslog('), source.indexOf('function copyFileWithProgress(')), scope);
  await scope.cleanupPasslog('/tmp/job');
  for (const suffix of ['', '.cutree', '.temp', '.cutree.temp']) assert.ok(removed.includes(`/tmp/job${suffix}`));
});
