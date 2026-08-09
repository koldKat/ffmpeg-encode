const fs = require('fs');
const path = require('path');

class QueueAppendError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'QueueAppendError';
    this.status = status;
  }
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function walkSupportedFiles(dir, videoExtensions) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkSupportedFiles(entryPath, videoExtensions));
    } else if (entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}

async function discoverAppendableFiles({
  requestedPath,
  sourceRoot,
  stagingRoot,
  existingPaths,
  videoExtensions,
}) {
  const resolvedPath = path.resolve(requestedPath);
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedStagingRoot = path.resolve(stagingRoot);

  if (!isPathWithin(resolvedSourceRoot, resolvedPath)) {
    throw new QueueAppendError('New files must be inside the active source root.');
  }
  if (isPathWithin(resolvedStagingRoot, resolvedPath)) {
    throw new QueueAppendError('The staging folder cannot be added to the queue.');
  }

  let candidates;
  try {
    const [realSourceRoot, realRequestedPath] = await Promise.all([
      fs.promises.realpath(resolvedSourceRoot),
      fs.promises.realpath(resolvedPath),
    ]);
    if (!isPathWithin(realSourceRoot, realRequestedPath)) {
      throw new QueueAppendError('New files must be inside the active source root.');
    }

    try {
      const realStagingRoot = await fs.promises.realpath(resolvedStagingRoot);
      if (isPathWithin(realStagingRoot, realRequestedPath)) {
        throw new QueueAppendError('The staging folder cannot be added to the queue.');
      }
    } catch (error) {
      if (error instanceof QueueAppendError) throw error;
      if (error.code !== 'ENOENT') throw error;
    }

    const requestedStat = await fs.promises.stat(resolvedPath);
    if (requestedStat.isDirectory()) {
      candidates = await walkSupportedFiles(resolvedPath, videoExtensions);
    } else if (requestedStat.isFile() && videoExtensions.has(path.extname(resolvedPath).toLowerCase())) {
      candidates = [resolvedPath];
    } else {
      throw new QueueAppendError('Path must be a supported video file or a directory.');
    }
  } catch (error) {
    if (error instanceof QueueAppendError) throw error;
    throw new QueueAppendError('File or folder path is not accessible.');
  }

  const knownPaths = new Set((existingPaths || []).map(filePath => path.resolve(filePath)));
  return [...new Set(candidates.map(filePath => path.resolve(filePath)))]
    .filter(filePath => isPathWithin(resolvedSourceRoot, filePath))
    .filter(filePath => !isPathWithin(resolvedStagingRoot, filePath))
    .filter(filePath => !knownPaths.has(filePath))
    .sort((a, b) => a.localeCompare(b));
}

module.exports = {
  QueueAppendError,
  discoverAppendableFiles,
  isPathWithin,
};
