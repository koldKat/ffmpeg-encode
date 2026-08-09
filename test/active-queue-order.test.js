const assert = require('node:assert/strict');
const test = require('node:test');
const { ActiveQueueOrderError, reorderActiveQueue } = require('../server/active-queue-order');

const queue = ['done', 'current', 'a', 'b', 'c'].map((fullPath, index) => ({ fullPath, index: index + 1 }));
const publicPaths = ['current', 'a', 'b', 'c'];

test('reorders only the submitted pending prefix after the current item', () => {
  const reordered = reorderActiveQueue({
    queue,
    publicPaths,
    activePath: 'current',
    requestedOrder: ['current', 'b', 'a'],
  });

  assert.deepEqual(reordered.map(item => item.fullPath), ['done', 'current', 'b', 'a', 'c']);
  assert.deepEqual(reordered.map(item => item.index), [1, 2, 3, 4, 5]);
});

test('rejects moving the current item', () => {
  assert.throws(
    () => reorderActiveQueue({
      queue,
      publicPaths,
      activePath: 'current',
      requestedOrder: ['a', 'current', 'b'],
    }),
    error => error instanceof ActiveQueueOrderError,
  );
});

test('rejects substituting an unseen pending item into the loaded prefix', () => {
  assert.throws(
    () => reorderActiveQueue({
      queue,
      publicPaths,
      activePath: 'current',
      requestedOrder: ['current', 'c', 'a'],
    }),
    error => error instanceof ActiveQueueOrderError,
  );
});
