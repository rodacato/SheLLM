const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { check } = require('../../scripts/check-doc-paths');

describe('documentation paths', () => {
  it('names no module the architecture guide cannot point at', () => {
    const { pathCount, fileCount, missingPaths, missingFiles } = check(['docs/guides/architecture.md']);

    assert.ok(pathCount + fileCount > 20, `extracted only ${pathCount + fileCount} references, so nothing was proven`);
    assert.deepStrictEqual(missingPaths, [], `paths that do not exist: ${missingPaths.join(', ')}`);
    assert.deepStrictEqual(missingFiles, [], `filenames absent from src/: ${missingFiles.join(', ')}`);
  });

  it('holds for the guides a contributor follows', () => {
    const docs = ['CONTRIBUTING.md', 'docs/guides/deployment.md', 'docs/guides/releasing.md'];
    const { missingPaths } = check(docs);
    assert.deepStrictEqual(missingPaths, [], `paths that do not exist: ${missingPaths.join(', ')}`);
  });
});
