const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createQueueModel } = require('../server/queue-model');

const defaults = {
  sourceRoot: '.', outRoot: '/out', encoder: 'x265', preset: 'slow', mbPerMin: 10, mbStep: 50,
  audioKbit: 192, minVideoKbit: 300, overheadPct: 1, ffmpegLoglevel: 'error',
  x264Profile: 'high', x264Level: '4.1', encThreads: 0, deleteSource: false,
};

function model() {
  return createQueueModel({
    defaults,
    expandHome: value => value,
    fs: { existsSync: () => true },
    path,
    resolveDeleteSource: (overrides, config) => overrides.deleteSource ?? config.deleteSource,
  });
}

test('resolves a language separately for every file and falls back to track zero', () => {
  const { resolveAudioTrackByLanguage } = model();
  assert.equal(resolveAudioTrackByLanguage({ audioTracks: [{ index: 0, language: 'jpn' }, { index: 1, language: 'eng' }] }, 'eng'), 1);
  assert.equal(resolveAudioTrackByLanguage({ audioTracks: [{ index: 0, language: 'eng' }, { index: 1, language: 'jpn' }] }, 'eng'), 0);
  assert.equal(resolveAudioTrackByLanguage({ audioTracks: [{ index: 0, language: 'jpn' }] }, 'eng'), 0);
});

test('preserves saved queue items before newly discovered files', () => {
  const { mergePersistedQueuePlan } = model();
  const queue = mergePersistedQueuePlan(['/source/a.mkv', '/source/b.mkv'], [{
    fullPath: '/source/b.mkv', encoder: 'x264', audioTrack: 1,
  }], { ...defaults, sourceRoot: '/source' });
  assert.deepEqual(queue.map(item => [item.fullPath, item.encoder, item.audioTrack]), [
    ['/source/b.mkv', 'x264', 1],
    ['/source/a.mkv', 'x265', 0],
  ]);
});

test('saved configurations gain default niceness and retain a fixed internal size margin', () => {
  const queue = model();
  assert.equal(queue.normalizeConfig({}).nice, 15);
  assert.equal(queue.normalizeConfig({ nice: 0 }).nice, 0);
  assert.equal(queue.normalizeConfig({ nice: 25 }).nice, 19);
  assert.equal(queue.normalizeConfig({ nice: 'invalid' }).nice, 15);
  assert.equal(queue.normalizeConfig({ overheadPct: 90 }).overheadPct, 1);
});


test('legacy tune settings are discarded and per-file encoder choices persist', () => {
  const queue = model();
  const config = queue.normalizeConfig({ tune: 'film', x264Profile: 'high', x264Level: '4.1' });
  assert.equal(config.encoder, 'x265');
  assert.equal('tune' in config, false);
  assert.equal(queue.createQueueItem('/source/a.mkv', 1, config, { tune: 'animation' }).encoder, 'x265');
  const item = queue.createQueueItem('/source/a.mkv', 1, config, { encoder: 'x264' });
  assert.equal(item.encoder, 'x264');
  assert.equal(queue.serializeQueuePlanItems([item])[0].encoder, 'x264');
});
