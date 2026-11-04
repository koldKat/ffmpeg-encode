// Exercise the actual browser lifecycle functions with controlled network and EventSource boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(name, context, asset = 'app.js') {
  const raw = fs.readFileSync(require.resolve('../public/js/' + asset), 'utf8');
  const start = raw.indexOf('function ' + name + '('), end = raw.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start);
  const prefix = raw.slice(Math.max(0, start - 6), start).endsWith('async ') ? 'async ' : '';
  vm.createContext(context); vm.runInContext(prefix + raw.slice(start, end), context);
  return context[name];
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('custom API headers retain JSON content type and the signed-in bearer token', async () => {
  let request;
  const c = { getToken: () => 'test-token', fetch: async (url, options) => { request = options; return { ok: true, json: async () => ({ ok: true }) }; } };
  const api = load('apiFetch', c);
  await api('/test', { method: 'POST', headers: { 'X-Test': 'yes' } });
  assert.equal(request.method, 'POST'); assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(request.headers.Authorization, 'Bearer test-token'); assert.equal(request.headers['X-Test'], 'yes');
});

test('transient SSE errors retain EventSource for reconnect and subsequent queue updates', () => {
  let closed = 0, renders = 0;
  const c = { eventSource: null, lastState: null, activeQueue: [], fullQueue: [], els: { heroMetaText: {}, heroMeta: { setAttribute() {} } }, getToken: () => 'test', clearQueueSelection() {}, closeEvents() { c.eventSource?.close(); }, resetActiveQueue(q) { c.activeQueue = q; }, mergeQueueItems: (a, b) => b, render(s) { c.lastState = s; renders++; }, EventSource: class { close() { closed++; } } };
  load('openEvents', c)(); const stream = c.eventSource; stream.onerror(); assert.equal(closed, 0);
  stream.onmessage({ data: JSON.stringify({ active: true, startedAt: 'run1', queueInfo: { total: 2 }, queue: [{ fullPath: '/a' }, { fullPath: '/b' }] }) });
  assert.equal(renders, 1); assert.equal(c.activeQueue[0].fullPath, '/a');
  stream.onmessage({ data: JSON.stringify({ active: true, startedAt: 'run1', queueInfo: { total: 2 }, queue: [{ fullPath: '/b' }, { fullPath: '/a' }] }) });
  assert.equal(c.activeQueue[0].fullPath, '/b'); assert.equal(renders, 2);
});

test('an active page response cannot overwrite a newer queue order', async () => {
  const gate = deferred(); let merged = 0, rendered = 0;
  const c = { lastState: { active: true, startedAt: 'run1', queueInfo: { total: 3 } }, activeQueue: [{ fullPath: '/a' }, { fullPath: '/b' }], activeQueueFetchInFlight: false, ACTIVE_QUEUE_PAGE_SIZE: 50, apiFetch: () => gate.promise, mergeQueueItems() { merged++; }, render() { rendered++; } };
  const pending = load('fetchNextActiveQueuePage', c)();
  c.activeQueue = [{ fullPath: '/a' }, { fullPath: '/different' }]; gate.resolve({ queue: [{ fullPath: '/old' }], state: { active: true } });
  await pending; assert.equal(merged, 0); assert.equal(rendered, 0); assert.equal(c.activeQueueFetchInFlight, false);
});

test('an idle queue response cannot restore an editor after a scan begins', async () => {
  const gate = deferred(); let updates = 0;
  const c = { lastState: { active: false, startedAt: null }, queueFetchInFlight: false, apiFetch: () => gate.promise, setFullQueue() { updates++; }, render() { updates++; } };
  const pending = load('fetchFullQueue', c)();
  c.lastState.scan = { inProgress: true };gate.resolve({ queue: [], state: { active: false } });
  await pending; assert.equal(updates, 0); assert.equal(c.queueFetchInFlight, false);
});
