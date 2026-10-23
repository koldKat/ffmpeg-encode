const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter, once } = require('node:events');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { normalizeNice, spawnEncoder } = require('../server/encoder-process');

function fakeEncoder(nice, error) {
  const child = new EventEmitter();
  child.pid = 123;
  const kills = [], priorities = [], commands = [];
  child.kill = signal => kills.push(signal);
  const result = spawnEncoder(['-pass', '2'], { nice }, {
    spawn: (...args) => { commands.push(args); return child; },
    setPriority: (...args) => { priorities.push(args); if (error) throw error; },
  });
  assert.equal(result, child);
  return { child, kills, priorities, commands };
}

test('niceness defaults to 15 and accepts only nonnegative integer priorities through 19', () => {
  for (const value of [undefined, null, '', 'bad', Infinity]) assert.equal(normalizeNice(value), 15);
  assert.equal(normalizeNice(0), 0);
  assert.equal(normalizeNice('12'), 12);
  assert.equal(normalizeNice(5.9), 5);
  assert.equal(normalizeNice(-10), 0);
  assert.equal(normalizeNice(100), 19);
});

test('encoder retains the FFmpeg PID, pipes and process group while setting absolute niceness', () => {
  for (const nice of [undefined, 0, 15, 19]) {
    const { child, kills, priorities, commands } = fakeEncoder(nice);
    child.emit('spawn');
    assert.deepEqual(priorities, [[123, nice ?? 15]]);
    assert.deepEqual(commands, [['ffmpeg', ['-pass', '2'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }]]);
    assert.deepEqual(kills, []);
  }
});

test('priority failure stops encoding and reports a useful error', () => {
  const { child, kills } = fakeEncoder(15, Object.assign(new Error('permission denied'), { code: 'EPERM' }));
  let failure;
  child.on('error', error => { failure = error; });
  child.emit('spawn');
  assert.deepEqual(kills, ['SIGKILL']);
  assert.match(failure.message, /encoder niceness to 15.*permission denied/);
});

test('an encoder which already exited is left for its normal close handler', () => {
  const { child, kills } = fakeEncoder(15, Object.assign(new Error('gone'), { code: 'ESRCH' }));
  child.emit('spawn');
  assert.deepEqual(kills, []);
});

test('the OS applies niceness to an actual child process', { skip: process.platform === 'win32' }, async () => {
  const child = spawnEncoder([], { nice: 19 }, {
    spawn: () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }),
  });
  try {
    await once(child, 'spawn');
    assert.equal(os.getPriority(child.pid), 19);
  } finally {
    const closed = once(child, 'close');
    child.kill('SIGTERM');
    await closed;
  }
});
