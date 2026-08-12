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

function finalOutputPath({ sourcePath, destinationDir, baseName, deleteSource, sourcePaths = [] }) {
  const requestedPath = path.join(destinationDir, `${baseName}.mp4`);
  const resolvedSource = path.resolve(sourcePath);
  const resolvedRequested = path.resolve(requestedPath);
  const otherSources = new Set(sourcePaths
    .map(candidate => path.resolve(candidate))
    .filter(candidate => candidate !== resolvedSource));
  const replacesAnotherSource = otherSources.has(resolvedRequested);
  if (!replacesAnotherSource && (deleteSource || resolvedRequested !== resolvedSource)) return requestedPath;

  let suffix = 1;
  while (true) {
    const marker = suffix === 1 ? '.encoded' : `.encoded-${suffix}`;
    const candidate = path.join(destinationDir, `${baseName}${marker}.mp4`);
    if (!otherSources.has(path.resolve(candidate))) return candidate;
    suffix += 1;
  }
}

function isPreservedSourceOutput(filePath) {
  return /\.encoded(?:-\d+)?\.mp4$/i.test(path.basename(String(filePath || '')));
}

module.exports = {
  allSourcesSelected,
  finalOutputPath,
  isPreservedSourceOutput,
  resolveDeleteSource,
};
