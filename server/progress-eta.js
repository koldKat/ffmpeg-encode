function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function createLiveProgressEta({ now = () => Date.now(), minElapsedSeconds = 20, minProgressPoints = 0.002 } = {}) {
  let sample = null;

  function reset() {
    sample = null;
  }

  function pause() {
    if (sample) sample.paused = true;
  }

  function observe(overallPct) {
    const percent = Math.min(100, finiteNonNegative(overallPct));
    const timestamp = now();
    if (!sample) {
      sample = { timestamp, percent, elapsedSeconds: 0, gainedPoints: 0, paused: false };
      return null;
    }

    if (sample.paused) {
      sample.timestamp = timestamp;
      sample.percent = percent;
      sample.paused = false;
      return null;
    }

    // Appending work can lower overall progress. Discard the old rate rather
    // than allowing that legitimate negative jump to distort the estimate.
    if (percent < sample.percent) {
      sample = { timestamp, percent, elapsedSeconds: 0, gainedPoints: 0, paused: false };
      return null;
    }

    sample.elapsedSeconds += Math.max(0, (timestamp - sample.timestamp) / 1000);
    sample.gainedPoints += percent - sample.percent;
    sample.timestamp = timestamp;
    sample.percent = percent;

    if (sample.elapsedSeconds < minElapsedSeconds || sample.gainedPoints < minProgressPoints) return null;
    const pointsPerSecond = sample.gainedPoints / sample.elapsedSeconds;
    if (!Number.isFinite(pointsPerSecond) || pointsPerSecond <= 0) return null;
    return Math.max(0, Math.round((100 - percent) / pointsPerSecond));
  }

  return { observe, pause, reset };
}

function blendEtaSeconds(liveSeconds, completedFileSeconds, encodedCount) {
  const live = liveSeconds == null || !Number.isFinite(Number(liveSeconds)) ? null : Math.max(0, Number(liveSeconds));
  const completed = completedFileSeconds == null || !Number.isFinite(Number(completedFileSeconds))
    ? null
    : Math.max(0, Number(completedFileSeconds));
  if (live == null) return completed;
  if (completed == null) return live;

  // Finished files grow more representative, but live progress still captures
  // the current file rather than waiting for the next completion boundary.
  const completedWeight = Math.min(0.8, 0.3 + (Math.max(0, Number(encodedCount) || 0) * 0.1));
  return Math.round((completed * completedWeight) + (live * (1 - completedWeight)));
}

module.exports = { blendEtaSeconds, createLiveProgressEta };
