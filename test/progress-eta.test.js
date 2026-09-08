const assert = require('node:assert/strict');
const test = require('node:test');
const { blendEtaSeconds, createLiveProgressEta } = require('../server/progress-eta');

test('estimates remaining batch time before a file completes from overall progress', () => {
  let timestamp = 0;
  const eta = createLiveProgressEta({ now: () => timestamp, minElapsedSeconds: 20, minProgressPoints: 0.002 });
  assert.equal(eta.observe(0), null);
  timestamp = 20_000;
  assert.equal(eta.observe(2), 980);
});

test('restarts the live sample when a queue append lowers overall progress', () => {
  let timestamp = 0;
  const eta = createLiveProgressEta({ now: () => timestamp, minElapsedSeconds: 20, minProgressPoints: 0.002 });
  eta.observe(0);
  timestamp = 20_000;
  eta.observe(2);
  timestamp = 21_000;
  assert.equal(eta.observe(1), null);
});

test('does not include explicitly paused time in the rate sample', () => {
  let timestamp = 0;
  const eta = createLiveProgressEta({ now: () => timestamp, minElapsedSeconds: 20, minProgressPoints: 0.002 });
  eta.observe(0);
  timestamp = 10_000;
  eta.observe(1);
  eta.pause();
  timestamp = 1_010_000;
  eta.observe(1);
  timestamp = 1_020_000;
  assert.equal(eta.observe(2), 980);
});

test('blends live progress with completed-file timing once samples exist', () => {
  assert.equal(blendEtaSeconds(1_000, null, 0), 1_000);
  assert.equal(blendEtaSeconds(null, 900, 1), 900);
  assert.equal(blendEtaSeconds(1_000, 900, 1), 960);
});
