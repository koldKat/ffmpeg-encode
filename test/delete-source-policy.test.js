const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  allSourcesSelected,
  finalOutputPath,
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
