function normalizeEncoder(value) {
  return String(value || '').trim().toLowerCase() === 'x264' ? 'x264' : 'x265';
}

module.exports = { normalizeEncoder };
