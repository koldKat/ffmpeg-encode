const assert = require('node:assert/strict');
const test = require('node:test');
const { QueueInspectionStore } = require('../server/queue-inspections');

test('inspection tokens are single-use and scoped to their user', () => {
  const store = new QueueInspectionStore();
  const id = store.create(7, { items: ['episode.mkv'] });

  assert.equal(store.consume(id, 8), null);
  assert.deepEqual(store.consume(id, 7), { items: ['episode.mkv'] });
  assert.equal(store.consume(id, 7), null);
});

test('expired inspection tokens cannot be consumed', () => {
  const store = new QueueInspectionStore({ ttlMs: -1 });
  const id = store.create(7, { items: [] });

  assert.equal(store.consume(id, 7), null);
});
