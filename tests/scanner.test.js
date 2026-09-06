import { test } from 'node:test';
import assert from 'node:assert';
import { mkdir, rm, chmod } from 'node:fs/promises';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scanFileSystem,
  streamFileSystem,
} from '../src/scanner/walk.js';
import { getFileId, resolveFullPath, computeContentHash } from '../src/scanner/fileUtils.js';
import { detectType } from '../src/scanner/constants.js';

const TMP_PREFIX = join(tmpdir(), 'media-engine-scanner-test-');

async function createTempDir() {
  return mkdtemp(TMP_PREFIX);
}

async function cleanupDir(path) {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {}
}

test('scanFileSystem returns files in a directory', async () => {
  const root = await createTempDir();
  try {
    await writeFile(join(root, 'movie.mp4'), '');
    await writeFile(join(root, 'song.mp3'), '');

    const entries = await scanFileSystem(root);

    assert.strictEqual(entries.length, 2);
    const names = entries.map(e => e.name).sort();
    assert.deepStrictEqual(names, ['movie.mp4', 'song.mp3']);
  } finally {
    await cleanupDir(root);
  }
});

test('scanFileSystem returns empty array for empty directory', async () => {
  const root = await createTempDir();
  try {
    const entries = await scanFileSystem(root);
    assert.strictEqual(entries.length, 0);
  } finally {
    await cleanupDir(root);
  }
});

test('scanFileSystem recurses into subdirectories', async () => {
  const root = await createTempDir();
  try {
    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'top.mp4'), '');
    await writeFile(join(root, 'sub', 'nested.mp4'), '');

    const entries = await scanFileSystem(root, '', { recursive: true });

    assert.strictEqual(entries.length, 2);
    const names = entries.map(e => e.name).sort();
    assert.deepStrictEqual(names, ['nested.mp4', 'top.mp4']);
  } finally {
    await cleanupDir(root);
  }
});

test('scanFileSystem handles unreadable directories gracefully', async () => {
  const root = await createTempDir();
  try {
    await mkdir(join(root, 'restricted'), { recursive: true });
    await writeFile(join(root, 'ok.mp4'), '');

    try {
      await chmod(join(root, 'restricted'), 0o000);
    } catch {
      await cleanupDir(root);
      return;
    }

    try {
      const entries = await scanFileSystem(root);
      const names = entries.map(e => e.name);
      assert.ok(!names.includes('restricted'));
      assert.ok(names.includes('ok.mp4'));
    } finally {
      await chmod(join(root, 'restricted'), 0o755);
    }
  } finally {
    await cleanupDir(root);
  }
});

test('getFileId generates consistent IDs for same path', () => {
  const id1 = getFileId('videos/movie.mp4');
  const id2 = getFileId('videos/movie.mp4');
  assert.strictEqual(id1, id2);
});

test('getFileId generates different IDs for different paths', () => {
  const id1 = getFileId('videos/movie.mp4');
  const id2 = getFileId('videos/song.mp3');
  assert.notStrictEqual(id1, id2);
});

test('resolveFullPath resolves relative path in single root', () => {
  const result = resolveFullPath('videos/movie.mp4', ['/media']);
  assert.strictEqual(result, '/media/videos/movie.mp4');
});

test('resolveFullPath resolves relative path in multi-root', () => {
  const result = resolveFullPath('movies/movie.mp4', [
    '/media/photos',
    '/media/movies',
  ]);
  assert.strictEqual(result, '/media/movies/movie.mp4');
});

test('computeContentHash returns a string hash', async () => {
  const root = await createTempDir();
  try {
    const filePath = join(root, 'video.mp4');
    await writeFile(filePath, 'some content here');

    const hash = await computeContentHash(filePath, 17);

    assert.ok(typeof hash === 'string');
    assert.strictEqual(hash.length, 32);
  } finally {
    await cleanupDir(root);
  }
});

test('computeContentHash returns same hash for same file', async () => {
  const root = await createTempDir();
  try {
    const filePath = join(root, 'video.mp4');
    await writeFile(filePath, 'identical content');

    const hash1 = await computeContentHash(filePath, 16);
    const hash2 = await computeContentHash(filePath, 16);

    assert.strictEqual(hash1, hash2);
  } finally {
    await cleanupDir(root);
  }
});

test('detectType returns "video" for video extensions', () => {
  assert.strictEqual(detectType('.mp4'), 'video');
  assert.strictEqual(detectType('.mkv'), 'video');
  assert.strictEqual(detectType('.mov'), 'video');
});

test('detectType returns "audio" for audio extensions', () => {
  assert.strictEqual(detectType('.mp3'), 'audio');
  assert.strictEqual(detectType('.flac'), 'audio');
  assert.strictEqual(detectType('.opus'), 'audio');
});

test('detectType returns "image" for image extensions', () => {
  assert.strictEqual(detectType('.png'), 'image');
  assert.strictEqual(detectType('.jpg'), 'image');
  assert.strictEqual(detectType('.webp'), 'image');
});

test('detectType returns "other" for unknown extensions', () => {
  assert.strictEqual(detectType('.txt'), 'other');
  assert.strictEqual(detectType('.zip'), 'other');
});
