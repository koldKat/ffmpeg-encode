const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { QueueAppendError, discoverAppendableFiles } = require('../server/queue-append');

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4']);

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-queue-append-'));
  const sourceRoot = path.join(root, 'source');
  const stagingRoot = path.join(sourceRoot, 'staging');
  const season = path.join(sourceRoot, 'Season 1');
  await fs.promises.mkdir(stagingRoot, { recursive: true });
  await fs.promises.mkdir(season, { recursive: true });
  await fs.promises.writeFile(path.join(season, 'episode-01.mkv'), 'video');
  await fs.promises.writeFile(path.join(season, 'episode-02.mp4'), 'video');
  await fs.promises.writeFile(path.join(season, 'notes.txt'), 'text');
  await fs.promises.writeFile(path.join(stagingRoot, 'output.mp4'), 'video');
  return { root, sourceRoot, stagingRoot, season };
}

test('discovers supported files recursively and removes existing paths', async t => {
  const paths = await fixture();
  t.after(() => fs.promises.rm(paths.root, { recursive: true, force: true }));
  const episodeOne = path.join(paths.season, 'episode-01.mkv');

  const files = await discoverAppendableFiles({
    requestedPath: paths.sourceRoot,
    sourceRoot: paths.sourceRoot,
    stagingRoot: paths.stagingRoot,
    existingPaths: [episodeOne],
    videoExtensions: VIDEO_EXTENSIONS,
  });

  assert.deepEqual(files, [path.join(paths.season, 'episode-02.mp4')]);
});

test('accepts a supported file path', async t => {
  const paths = await fixture();
  t.after(() => fs.promises.rm(paths.root, { recursive: true, force: true }));
  const episode = path.join(paths.season, 'episode-01.mkv');

  const files = await discoverAppendableFiles({
    requestedPath: episode,
    sourceRoot: paths.sourceRoot,
    stagingRoot: paths.stagingRoot,
    existingPaths: [],
    videoExtensions: VIDEO_EXTENSIONS,
  });

  assert.deepEqual(files, [episode]);
});

test('rejects paths outside the active source root', async t => {
  const paths = await fixture();
  t.after(() => fs.promises.rm(paths.root, { recursive: true, force: true }));

  await assert.rejects(
    discoverAppendableFiles({
      requestedPath: paths.root,
      sourceRoot: paths.sourceRoot,
      stagingRoot: paths.stagingRoot,
      existingPaths: [],
      videoExtensions: VIDEO_EXTENSIONS,
    }),
    error => error instanceof QueueAppendError && /source root/.test(error.message),
  );
});

test('rejects the staging folder', async t => {
  const paths = await fixture();
  t.after(() => fs.promises.rm(paths.root, { recursive: true, force: true }));

  await assert.rejects(
    discoverAppendableFiles({
      requestedPath: paths.stagingRoot,
      sourceRoot: paths.sourceRoot,
      stagingRoot: paths.stagingRoot,
      existingPaths: [],
      videoExtensions: VIDEO_EXTENSIONS,
    }),
    error => error instanceof QueueAppendError && /staging folder/.test(error.message),
  );
});

test('rejects a source symlink that resolves outside the source root', async t => {
  const paths = await fixture();
  t.after(() => fs.promises.rm(paths.root, { recursive: true, force: true }));
  const outside = path.join(paths.root, 'outside');
  const link = path.join(paths.sourceRoot, 'external');
  await fs.promises.mkdir(outside);
  await fs.promises.writeFile(path.join(outside, 'external.mkv'), 'video');
  await fs.promises.symlink(outside, link);

  await assert.rejects(
    discoverAppendableFiles({
      requestedPath: link,
      sourceRoot: paths.sourceRoot,
      stagingRoot: paths.stagingRoot,
      existingPaths: [],
      videoExtensions: VIDEO_EXTENSIONS,
    }),
    error => error instanceof QueueAppendError && /source root/.test(error.message),
  );
});
