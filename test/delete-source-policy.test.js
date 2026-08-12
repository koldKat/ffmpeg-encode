const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  allSourcesSelected,
  finalOutputPath,
  isPreservedSourceOutput,
  resolveDeleteSource,
} = require('../server/delete-source-policy');

test('an explicit per-file choice overrides the global setting', () => {
  assert.equal(resolveDeleteSource({ deleteSource: false }, { deleteSource: true }), false);
  assert.equal(resolveDeleteSource({}, { deleteSource: true }), true);
});

test('global selection is true only when every queued file is selected', () => {
  assert.equal(allSourcesSelected([{ deleteSource: true }, { deleteSource: true }]), true);
  assert.equal(allSourcesSelected([{ deleteSource: true }, { deleteSource: false }]), false);
  assert.equal(allSourcesSelected([], true), true);
});

test('an unchecked same-path MP4 gets a non-destructive output name', () => {
  const sourcePath = path.join('/source', 'episode.mp4');
  assert.equal(finalOutputPath({
    sourcePath,
    destinationDir: path.dirname(sourcePath),
    baseName: 'episode',
    deleteSource: false,
  }), path.join('/source', 'episode.encoded.mp4'));
  assert.equal(finalOutputPath({
    sourcePath,
    destinationDir: path.dirname(sourcePath),
    baseName: 'episode',
    deleteSource: true,
  }), sourcePath);
});

test('recognizes app-generated preserved-source outputs case-insensitively', () => {
  assert.equal(isPreservedSourceOutput('/source/episode.encoded.mp4'), true);
  assert.equal(isPreservedSourceOutput('/source/episode.encoded-2.mp4'), true);
  assert.equal(isPreservedSourceOutput('/source/EPISODE.ENCODED.MP4'), true);
  assert.equal(isPreservedSourceOutput('/source/episode.mp4'), false);
});

test('never targets a different queued source with the same basename', () => {
  const mkvSource = path.join('/source', 'episode.mkv');
  const mp4Source = path.join('/source', 'episode.mp4');
  assert.equal(finalOutputPath({
    sourcePath: mkvSource,
    destinationDir: path.dirname(mkvSource),
    baseName: 'episode',
    deleteSource: true,
    sourcePaths: [mkvSource, mp4Source],
  }), path.join('/source', 'episode.encoded.mp4'));
});

test('increments the protected output name when its first fallback is another source', () => {
  const mkvSource = path.join('/source', 'episode.mkv');
  assert.equal(finalOutputPath({
    sourcePath: mkvSource,
    destinationDir: path.dirname(mkvSource),
    baseName: 'episode',
    deleteSource: true,
    sourcePaths: [
      mkvSource,
      path.join('/source', 'episode.mp4'),
      path.join('/source', 'episode.encoded.mp4'),
    ],
  }), path.join('/source', 'episode.encoded-2.mp4'));
});
