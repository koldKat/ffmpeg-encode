const assert = require('node:assert/strict');
const test = require('node:test');
const { createEncodingMath } = require('../server/encoding-math');

const math = createEncodingMath({
  defaults: { mbPerMin: 10, mbStep: 50 },
  clampNonNegative: (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback,
});

test('rounds target size up to the configured step', () => {
  assert.equal(math.computeTargetSizeMb(61, { mbPerMin: 10, mbStep: 50 }), 50);
  assert.equal(math.computeTargetSizeMb(601, { mbPerMin: 10, mbStep: 50 }), 150);
});
