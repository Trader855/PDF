import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilePaths } from '../path-utils.mjs';

test('Windows paths keep drive, filename and parent directory', () => {
  const paths = createFilePaths('win32');
  const source = 'C:\\Users\\Ada Lovelace\\Documents\\polizza.pdf';
  assert.equal(paths.normalize(source), 'C:/Users/Ada Lovelace/Documents/polizza.pdf');
  assert.equal(paths.basename(source), 'polizza.pdf');
  assert.equal(paths.dirname(source), 'C:/Users/Ada Lovelace/Documents');
  assert.equal(paths.join(paths.dirname(source), 'polizza - modificato.pdf'), 'C:/Users/Ada Lovelace/Documents/polizza - modificato.pdf');
  assert.equal(paths.normalize('C:\\'), 'C:/');
});

test('Windows path comparisons are case-insensitive', () => {
  const paths = createFilePaths('win32');
  assert.equal(paths.resolve('C:\\PDF\\FILE.pdf'), paths.resolve('c:/pdf/file.pdf'));
});

test('macOS paths preserve POSIX semantics', () => {
  const paths = createFilePaths('darwin');
  assert.equal(paths.normalize('/Users/ada/../ada/file.pdf'), '/Users/ada/file.pdf');
  assert.equal(paths.dirname('/Users/ada/file.pdf'), '/Users/ada');
});
