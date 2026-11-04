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

test('a full store retains valid tokens until another inspection is created', () => {
  const store = new QueueInspectionStore({ maxEntries: 1 });
  const first = store.create(7, { runId: 11, items: ['first.mkv'] });
  assert.equal(store.get(first, 7, 11).items[0], 'first.mkv');
  assert.equal(store.get(first, 7, 12), null);
  assert.equal(store.consume(first, 7, 11).items[0], 'first.mkv');
  const second = store.create(7, { runId: 11, items: ['second.mkv'] });
  const third = store.create(7, { runId: 11, items: ['third.mkv'] });
  assert.equal(store.get(second, 7, 11), null);
  assert.equal(store.get(third, 7, 11).items[0], 'third.mkv');
});

test('checking an inspection does not consume it before request validation succeeds', () => {
  const store = new QueueInspectionStore();
  const id = store.create(7, { runId: 11, items: ['episode.mkv'] });
  assert.ok(store.get(id, 7, 11));
  assert.ok(store.get(id, 7, 11));
  assert.ok(store.consume(id, 7, 11));
  assert.equal(store.get(id, 7, 11), null);
});
