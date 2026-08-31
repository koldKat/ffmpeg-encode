function ceilDiv(numerator, denominator) {
  return Math.floor((numerator + denominator - 1) / denominator);
}

function createEncodingMath({ defaults, clampNonNegative }) {
  function computeTargetSizeMb(durationSeconds, config) {
    const mbPerMin = clampNonNegative(config?.mbPerMin, defaults.mbPerMin);
    const mbStep = Math.max(1, clampNonNegative(config?.mbStep, defaults.mbStep));
    const rawTargetMb = (Math.max(0, Number(durationSeconds) || 0) / 60) * mbPerMin;
    return Math.max(1, ceilDiv(Math.ceil(rawTargetMb * 1000), mbStep * 1000)) * mbStep;
  }

  function computeVideoKbps(sizeMb, durationSeconds, config) {
    const totalBits = sizeMb * 1000000 * 8;
    const averageTotalBps = Math.floor(totalBits / durationSeconds);
    const audioBps = clampNonNegative(config.audioKbit, 192) * 1000;
    const overhead = clampNonNegative(config.overheadPct, 1);
    const videoBps = Math.floor((averageTotalBps - audioBps) * (100 - overhead) / 100);
    return Math.max(Math.floor(videoBps / 1000), clampNonNegative(config.minVideoKbit, 300));
  }

  return { computeTargetSizeMb, computeVideoKbps };
}

module.exports = { createEncodingMath };
