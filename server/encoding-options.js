function normalizeEncoder(value) {
  return String(value || '').trim().toLowerCase() === 'x265' ? 'x265' : 'x264';
}

module.exports = { normalizeEncoder };
