const path = require('node:path');

const TERMINAL_STATUSES = new Set(['encoded', 'skipped']);

function rootsMatch(left, right) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

function startableItems(queue = []) {
  return queue
    .filter(item => item?.fullPath && !TERMINAL_STATUSES.has(item.status))
    .map(item => ({ ...item }));
}

function chooseStartQueue({
  requestedSourceRoot,
  persistedSourceRoot,
  persistedQueue = [],
  currentSourceRoot,
  currentQueue = [],
}) {
  if (rootsMatch(persistedSourceRoot, requestedSourceRoot)) {
    const persisted = startableItems(persistedQueue);
    if (persisted.length) return persisted;
  }
  if (rootsMatch(currentSourceRoot, requestedSourceRoot)) {
    return startableItems(currentQueue);
  }
  return [];
}

module.exports = { chooseStartQueue, rootsMatch, startableItems };
