import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveFile } from '../src/resolver/resolveFile.js';

class SimpleMockRepo {
  constructor(files) {
    this._files = new Map(files.map(f => [f.id, { ...f }]));
  }
  getFileWithPath(id) {
    const file = this._files.get(id);
    if (!file) return null;
    return { ...file };
  }
}

async function makeTempDir() {
  return await mkdtemp(join(tmpdir(), 'resolver-test-'));
}

async function writeTestFile(dir, relativePath) {
  const fullPath = join(dir, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, 'test-content');
  return fullPath;
}

test('returns null when file not in repository', async () => {
  const repo = new SimpleMockRepo([]);
  const result = await resolveFile('missing-id', repo, ['/music']);
  assert.strictEqual(result, null);
});

test('resolves file in single root', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'Music/Artist', name: 'song.mp3', has_thumb: 1, thumb_cache_path: '/tc/song.jpg' },
  ]);
  const root = await makeTempDir();
  await writeTestFile(root, 'Music/Artist/song.mp3');

  const result = await resolveFile('f1', repo, [root]);
  assert.ok(result);
  assert.strictEqual(result.id, 'f1');
  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.fullPath, join(root, 'Music', 'Artist', 'song.mp3'));
  assert.strictEqual(result.relPath, join('Music', 'Artist', 'song.mp3'));
  assert.strictEqual(result.dirPath, 'Music/Artist');
  assert.strictEqual(result.hasThumb, 1);
  assert.strictEqual(result.thumbCachePath, '/tc/song.jpg');

  await rm(root, { recursive: true });
});

test('resolves file in first matching root when multiple roots', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'A', name: 'track.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root1 = await makeTempDir();
  const root2 = await makeTempDir();
  await writeTestFile(root1, 'A/track.mp3');
  await writeTestFile(root2, 'A/track.mp3');

  const result = await resolveFile('f1', repo, [root1, root2]);
  assert.ok(result);
  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.fullPath, join(root1, 'A', 'track.mp3'));

  await rm(root1, { recursive: true });
  await rm(root2, { recursive: true });
});

test('returns exists false when no root has the file', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'X', name: 'missing.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();

  const result = await resolveFile('f1', repo, [root]);
  assert.ok(result);
  assert.strictEqual(result.exists, false);
  assert.strictEqual(result.fullPath, join(root, 'X', 'missing.mp3'));

  await rm(root, { recursive: true });
});

test('fullPath includes correct root when file exists', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'A', name: 'file.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root1 = await makeTempDir();
  const root2 = await makeTempDir();
  await writeTestFile(root2, 'A/file.mp3');

  const result = await resolveFile('f1', repo, [root1, root2]);
  assert.ok(result);
  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.fullPath, join(root2, 'A', 'file.mp3'));

  await rm(root1, { recursive: true });
  await rm(root2, { recursive: true });
});

test('fullPath uses first root when file missing', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'A', name: 'ghost.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root1 = await makeTempDir();
  const root2 = await makeTempDir();

  const result = await resolveFile('f1', repo, [root1, root2]);
  assert.ok(result);
  assert.strictEqual(result.exists, false);
  assert.strictEqual(result.fullPath, join(root1, 'A', 'ghost.mp3'));

  await rm(root1, { recursive: true });
  await rm(root2, { recursive: true });
});

test('relPath is dir_path/name when dir_path exists', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'Music/Rock', name: 'song.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();
  await writeTestFile(root, 'Music/Rock/song.mp3');

  const result = await resolveFile('f1', repo, [root]);
  assert.strictEqual(result.relPath, join('Music', 'Rock', 'song.mp3'));

  await rm(root, { recursive: true });
});

test('relPath is just name when no dir_path', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: '', name: 'standalone.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();
  await writeTestFile(root, 'standalone.mp3');

  const result = await resolveFile('f1', repo, [root]);
  assert.strictEqual(result.relPath, 'standalone.mp3');

  await rm(root, { recursive: true });
});

test('dirPath matches file.dir_path', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'Music/Jazz', name: 'track.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();
  await writeTestFile(root, 'Music/Jazz/track.mp3');

  const result = await resolveFile('f1', repo, [root]);
  assert.strictEqual(result.dirPath, 'Music/Jazz');

  await rm(root, { recursive: true });
});

test('path traversal with .. is rejected (PATH_ESCAPE)', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: '..', name: 'escape.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();

  await assert.rejects(
    async () => await resolveFile('f1', repo, [root]),
    { code: 'PATH_ESCAPE' }
  );

  await rm(root, { recursive: true });
});

test('absolute path in relPath is rejected', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: '', name: '/etc/passwd', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();

  await assert.rejects(
    async () => await resolveFile('f1', repo, [root]),
    { code: 'PATH_ESCAPE' }
  );

  await rm(root, { recursive: true });
});

test('null byte in relPath is rejected', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: '', name: 'safe\x00evil.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const root = await makeTempDir();

  await assert.rejects(
    async () => await resolveFile('f1', repo, [root]),
    { code: 'PATH_ESCAPE' }
  );

  await rm(root, { recursive: true });
});

test('safe relative path in symlinked root is allowed (PATH_ESCAPE bypass)', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: 'Music', name: 'song.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const actualRoot = await makeTempDir();
  const mediaRoot = await makeTempDir();
  await writeTestFile(actualRoot, 'Music/song.mp3');
  await symlink(actualRoot, join(mediaRoot, 'music-link'));

  const result = await resolveFile('f1', repo, [join(mediaRoot, 'music-link')]);
  assert.ok(result);
  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.relPath, join('Music', 'song.mp3'));

  await rm(actualRoot, { recursive: true });
  await rm(mediaRoot, { recursive: true });
});

test('unsafe relPath containing .. in symlinked root is rejected', async () => {
  const repo = new SimpleMockRepo([
    { id: 'f1', dir_path: '..', name: 'escape.mp3', has_thumb: 0, thumb_cache_path: null },
  ]);
  const actualRoot = await makeTempDir();
  const mediaRoot = await makeTempDir();
  await writeTestFile(actualRoot, 'escape.mp3');
  await symlink(actualRoot, join(mediaRoot, 'music-link'));

  await assert.rejects(
    async () => await resolveFile('f1', repo, [join(mediaRoot, 'music-link')]),
    { code: 'PATH_ESCAPE' }
  );

  await rm(actualRoot, { recursive: true });
  await rm(mediaRoot, { recursive: true });
});
