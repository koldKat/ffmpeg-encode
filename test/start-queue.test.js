const assert = require('node:assert/strict');
const test = require('node:test');
const { chooseStartQueue } = require('../server/start-queue');

test('does not invent work when no queue is loaded or persisted', () => {
  assert.deepEqual(chooseStartQueue({
    requestedSourceRoot: '/media/source',
    persistedSourceRoot: '/media/source',
    persistedQueue: [],
    currentSourceRoot: '/media/source',
    currentQueue: [],
  }), []);
});

test('does not use a queue belonging to a different source root', () => {
  assert.deepEqual(chooseStartQueue({
    requestedSourceRoot: '/media/new-source',
    persistedSourceRoot: '/media/old-source',
    persistedQueue: [{ fullPath: '/media/old-source/a.mkv', status: 'pending' }],
    currentSourceRoot: '/media/old-source',
    currentQueue: [{ fullPath: '/media/old-source/b.mkv', status: 'pending' }],
  }), []);
});

test('ignores completed items and returns configured persisted work', () => {
  assert.deepEqual(chooseStartQueue({
    requestedSourceRoot: '/media/source',
    persistedSourceRoot: '/media/source',
    persistedQueue: [
      { fullPath: '/media/source/done.mkv', status: 'encoded' },
      { fullPath: '/media/source/pending.mkv', status: 'pending', deleteSource: true },
    ],
    currentSourceRoot: '/media/source',
    currentQueue: [],
  }), [{ fullPath: '/media/source/pending.mkv', status: 'pending', deleteSource: true }]);
});
