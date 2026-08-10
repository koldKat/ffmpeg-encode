const path = require('node:path');

function resolveDeleteSource(overrides = {}, config = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, 'deleteSource')) {
    return overrides.deleteSource === true;
  }
  return config.deleteSource === true;
}

function allSourcesSelected(queue = [], fallback = false) {
  return queue.length ? queue.every(item => item?.deleteSource === true) : fallback === true;
}

function finalOutputPath({ sourcePath, destinationDir, baseName, deleteSource }) {
  const requestedPath = path.join(destinationDir, `${baseName}.mp4`);
  if (deleteSource || path.resolve(requestedPath) !== path.resolve(sourcePath)) return requestedPath;
  return path.join(destinationDir, `${baseName}.encoded.mp4`);
}

module.exports = { allSourcesSelected, finalOutputPath, resolveDeleteSource };
