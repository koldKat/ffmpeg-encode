// Run the actual route bodies with controlled I/O boundaries, without binding ports or opening the live database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { QueueInspectionStore } = require('../server/queue-inspections');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function load(name, next, context) {
  const start = server.indexOf(`function ${name}(`), end = server.indexOf(`function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start);
  const prefix = server.slice(Math.max(0, start - 6), start).endsWith('async ') ? 'async ' : '';
  const code = prefix + server.slice(start, end).replace(/async\s*$/, '');
  vm.createContext(context);
  vm.runInContext(code, context);
  return context[name];
}
function base() {
  return {
    state: { active: true, config: { sourceRoot: '/source', tune: 'film', deleteSource: false }, queue: [], counts: {}, scan: {} },
    activeRunId: 11, activeUserId: 7, runnerPromise: {}, scanInProgress: false, path: require('node:path'),
    authenticate: async () => ({ user_id: 7 }), authorizeApp: () => true,
    send: (res, status, body) => Object.assign(res, { status, body }),
    clonePublicState: () => ({}),
  };
}

test('two start requests which overlap filesystem validation launch only one batch', async () => {
  const c = base(), gates = [], job = deferred(); let starts = 0;
  Object.assign(c, {
    state: { active: false, scan: { sourceRoot: '/source' }, queue: [{ fullPath: '/source/a.mkv' }] }, runnerPromise: null,
    readBody: async () => ({ sourceRoot: '/source' }), normalizeConfig: value => value,
    fs: { promises: { access: () => { const gate = deferred(); gates.push(gate); return gate.promise; } } },
    db: { saveUserSettings() {}, getUserQueuePlan: () => null }, MACHINE_NAME: 'test',
    chooseStartQueue: () => [{ fullPath: '/source/a.mkv' }],
    runJob: () => { starts += 1; c.state.active = true; return job.promise; },
  });
  const start = load('handleStart', 'handleStop', c), first = {}, second = {};
  const a = start({}, first), b = start({}, second);
  await flush(); assert.equal(gates.length, 2);
  gates[0].resolve(); await a; gates[1].resolve(); await b;
  assert.equal(starts, 1); assert.equal(first.status, 200); assert.equal(second.status, 409);
  job.resolve(); await flush();
});

test('an old force-stop timer never signals a replacement encoder', () => {
  const signals = [], c = { currentChild: { pid: 1 }, stopActiveChild: signal => signals.push(signal), APP_CONFIG: { timing: { forceKillDelayMs: 10 } } };
  let timer;
  c.setTimeout = callback => { timer = callback; return { unref() {} }; };
  const stop = load('forceStopActiveChild', 'shutdownServer', c);
  stop(); c.currentChild = { pid: 2 }; timer();
  assert.deepEqual(signals, ['SIGINT']);
});

for (const boundary of ['request body', 'file discovery', 'audio inspection']) {
  test(`inspection cannot move to a replacement batch during ${boundary}`, async () => {
    const c = base(), gate = deferred(); let discoveries = 0;
    Object.assign(c, {
      readBody: () => boundary === 'request body' ? gate.promise : Promise.resolve({ path: '/source/new.mkv' }),
      discoverActiveQueuePaths: () => { discoveries += 1; return boundary === 'file discovery' ? gate.promise : Promise.resolve(['/source/new.mkv']); },
      createQueueItem: fullPath => ({ fullPath }),
      enrichQueueAudioTracks: () => boundary === 'audio inspection' ? gate.promise : Promise.resolve(),
      queueInspections: new QueueInspectionStore(),
    });
    const inspect = load('handleQueueInspect', 'handleQueueAppend', c), response = {};
    const pending = inspect({}, response); await flush();
    c.activeRunId = 12;
    gate.resolve(boundary === 'request body' ? { path: '/source/new.mkv' } : ['/source/new.mkv']);
    await pending;
    assert.equal(response.status, 409); assert.equal(c.queueInspections.entries.size, 0);
    if (boundary === 'request body') assert.equal(discoveries, 0);
  });
}

test('a failed append remains retryable and successful append consumes its token', async () => {
  const c = base(), store = new QueueInspectionStore();
  const file = { fullPath: '/source/new.mkv', audioTracks: [{ index: 0 }] };
  const id = store.create(7, { runId: 11, sourceRoot: '/source', items: [file] });
  Object.assign(c, {
    readBody: async request => request.body, queueInspections: store,
    path: require('node:path'), fs: { existsSync: () => true }, QUEUE_PREVIEW_LIMIT: 50,
    createQueueItem: (fullPath, index, config, overrides) => ({ fullPath, index, ...overrides }),
    normalizeAudioTrack: value => Number(value), resolveAudioTrackByLanguage: () => 0,
    syncGlobalDeleteSource() {}, computeDerivedTotals() {}, saveQueuePlan() {}, persistRun() {}, pushEvent() {},
  });
  const append = load('handleQueueAppend', 'handleActiveQueueOrder', c), bad = {}, good = {}, stale = {};
  await append({ body: { inspectionId: id, items: [] } }, bad);
  assert.equal(bad.status, 400); assert.ok(store.get(id, 7, 11));
  await append({ body: { inspectionId: id, items: [{ fullPath: file.fullPath, tune: 'animation' }] } }, good);
  assert.equal(good.status, 200); assert.equal(c.state.queue[0].tune, 'animation'); assert.equal(store.get(id, 7, 11), null);
  const second = store.create(7, { runId: 11, sourceRoot: '/source', items: [file] });
  c.activeRunId = 12;
  await append({ body: { inspectionId: second, items: [file] } }, stale);
  assert.equal(stale.status, 409); assert.equal(c.state.queue.length, 1);
});

test('an idle queue edit is rejected if a batch starts while its body is arriving', async () => {
  const c = base(), gate = deferred(), response = {};
  c.state.active = false;c.activeRunId = null;c.runnerPromise = null;
  Object.assign(c, { hydrateIdleStateForUser() {}, readBody: () => gate.promise });
  const pending = load('handleQueue', 'discoverActiveQueuePaths', c)({ method: 'POST' }, response);
  await flush();c.state.active = true;gate.resolve({ filePaths: ['/source/a.mkv'], tune: 'animation' });
  await pending;assert.equal(response.status, 409);assert.equal(c.state.queue.length, 0);
});

test('source-deletion settings cannot change while a queue scan starts', async () => {
  const c = base(), gate = deferred(), response = {};
  c.state.active = false;c.activeRunId = null;
  c.readBody = () => gate.promise;
  const pending = load('handleQueueDeleteSource', 'handleQueueInspect', c)({}, response);
  await flush();c.scanInProgress = true;gate.resolve({ all: true, deleteSource: true });
  await pending;assert.equal(response.status, 409);assert.equal(c.state.config.deleteSource, false);
});

test('a pause request cannot signal a replacement encoder after reading its body', async () => {
  const c = base(), gate = deferred(), response = {};let signals = 0;
  Object.assign(c, { currentChild: { pid: 1 }, stopRequested: false, readBody: () => gate.promise, stopActiveChild: () => { signals++;return true; } });
  const pending = load('handlePauseToggle', 'handleStopAfterCurrent', c)({}, response);
  await flush();c.currentChild = { pid: 2 };gate.resolve({ enabled: true });
  await pending;assert.equal(response.status, 409);assert.equal(signals, 0);
});

test('a stop-after-current request cannot change a replacement batch', async () => {
  const c = base(), gate = deferred(), response = {};
  Object.assign(c, { stopRequested: false, stopAfterCurrentRequested: false, readBody: () => gate.promise });
  const pending = load('handleStopAfterCurrent', 'handlePathSuggest', c)({}, response);
  await flush();c.activeRunId = 12;gate.resolve({ enabled: true });
  await pending;assert.equal(response.status, 409);assert.equal(c.stopAfterCurrentRequested, false);
});

test('account deletion reports retained encoding history as a conflict', async () => {
  const response = {}, c = { authorizeLocalAdmin: () => true, readBody: async () => ({ username: 'former-user' }), sanitizeAdminUsername: s => s, REMOTE_USERNAME: 'protected', db: { deleteUserByUsername() { throw Object.assign(new Error('Encoding history retained'), { status: 409 }); } }, send: (res, status, body) => Object.assign(res, { status, body }) };
  await load('handleAdminDeleteUser', 'saveManualAppVersion', c)({}, response);
  assert.equal(response.status, 409);assert.equal(response.body.error, 'Encoding history retained');
});
