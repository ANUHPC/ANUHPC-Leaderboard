import test from 'node:test';
import assert from 'node:assert/strict';
import { mfcDecomposition } from './mfc-decomp.mjs';

test('2D shock-droplet supports four ranks with no z decomposition', () => {
  const d = mfcDecomposition(239, 59, 0, 4, 3);
  assert.equal(d.ok, true);
  assert.ok(d.split.endsWith('x1'));
});
test('inactive dimensions do not permit oversplitting a 1D or 2D grid', () => {
  assert.equal(mfcDecomposition(31, 0, 0, 1, 5).ok, true);
  assert.equal(mfcDecomposition(31, 0, 0, 2, 5).ok, false);
  assert.equal(mfcDecomposition(31, 31, 0, 4, 5).ok, false);
});
test('3D stencil-size constraints still reject the known invalid split', () => {
  assert.equal(mfcDecomposition(160, 80, 80, 32, 5).ok, false);
  assert.equal(mfcDecomposition(160, 80, 80, 16, 5).ok, true);
  assert.equal(mfcDecomposition(512, 256, 256, 8, 5).ok, true);
});
