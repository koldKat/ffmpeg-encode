const path = require('node:path');
const { randomUUID } = require('node:crypto');

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

function stagingOutputPath(outRoot, relativeSourcePath) {
  const root = path.resolve(outRoot);
  const dir = path.resolve(root, path.dirname(relativeSourcePath));
  const relative = path.relative(root, dir);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Staging output must remain inside the staging root.');
  }
  return path.join(dir, `.ffmpeg-stage-${randomUUID()}.mp4`);
}

function isPreservedSourceOutput(filePath) {
  const name = path.basename(String(filePath || ''));
  return /\.encoded(?:-\d+)?\.mp4$/i.test(name) || /\.ffmpeg-stage-[a-f0-9-]+\.mp4$/i.test(name);
}

module.exports = {
  allSourcesSelected,
  finalOutputPath,
  stagingOutputPath,
  isPreservedSourceOutput,
  resolveDeleteSource,
};
