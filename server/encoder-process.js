const os = require('node:os');
const { spawn: spawnProcess } = require('node:child_process');

function normalizeNice(value, fallback = 15) {
  const number = value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(number) ? Math.min(19, Math.max(0, Math.trunc(number))) : fallback;
}

function spawnEncoder(args, config = {}, { spawn = spawnProcess, setPriority = os.setPriority } = {}) {
  const nice = normalizeNice(config.nice);
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.once('spawn', () => {
    try {
      // Set the absolute niceness, rather than adding it to the server's priority.
      setPriority(child.pid, nice);
    } catch (error) {
      // A process which has already exited will be handled by its close event.
      if (error.code === 'ESRCH' || error.info?.code === 'ESRCH') return;
      child.kill('SIGKILL');
      child.emit('error', new Error(`Could not set encoder niceness to ${nice}: ${error.message}`, { cause: error }));
    }
  });
  return child;
}

module.exports = { normalizeNice, spawnEncoder };
