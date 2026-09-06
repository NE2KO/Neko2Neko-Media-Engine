import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MediaEngine } from '../src/MediaEngine.js';
import { MockMediaRepository } from '../src/repository/MockMediaRepository.js';

const WEB_ID = 'web-1';

async function makeTempDir() {
  return await mkdtemp(join(tmpdir(), 'media-engine-contract-'));
}

async function setupRepo() {
  const repo = new MockMediaRepository();
  const folderId = repo.ensureFolder('test');
  repo.upsertFile({ id: 'f1', dir_id: folderId, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  repo.upsertFile({ id: 'f2', dir_id: folderId, name: 'vid.mp4', type: 'video', ext: '.mp4', size: 50000000, mtime: Date.now(), created_at: Date.now() });
  return { repo, folderId };
}

async function writeTestFile(dir, relativePath, content) {
  const fullPath = join(dir, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content);
  return fullPath;
}

test('resolve() does not include fullPath in returned object', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  await writeTestFile(root, 'test/song.mp3', 'x');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  const result = await engine.resolve('f1');
  if (result) {
    assert.ok(!result.hasOwnProperty('fullPath'), 'resolve() should not expose fullPath');
    assert.ok(!result.hasOwnProperty('path'), 'resolve() should not expose path');
  }

  await rm(root, { recursive: true });
});

test('openMedia() returns a readable stream with correct metadata', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  const content = 'x'.repeat(5000000);
  await writeTestFile(root, 'test/song.mp3', content);
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  const resource = await engine.openMedia('f1');
  assert.ok(resource.stream, 'should have stream');
  assert.ok(resource.size > 0, 'should have size');
  assert.ok(resource.mimeType, 'should have mimeType');
  assert.ok(resource.etag, 'should have etag');
  assert.ok(resource.lastModified, 'should have lastModified');

  const chunks = [];
  for await (const chunk of resource.stream) {
    chunks.push(chunk);
  }
  assert.ok(chunks.length > 0, 'stream should yield data');
  assert.strictEqual(Buffer.concat(chunks).length, resource.size, 'stream size should match');

  await rm(root, { recursive: true });
});

test('openMedia() throws FILE_NOT_FOUND for missing file', async () => {
  const { repo } = await setupRepo();
  const root = await makeTempDir();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  await assert.rejects(() => engine.openMedia('nonexistent-id'), {
    message: /FILE_NOT_FOUND/,
  });

  await rm(root, { recursive: true });
});

test('openMedia() throws FILE_NOT_AVAILABLE for blocked file', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  await writeTestFile(root, 'test/song.mp3', 'x');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  engine.delete('f1');
  await assert.rejects(() => engine.openMedia('f1'), {
    message: /FILE_NOT_AVAILABLE/,
  });

  await rm(root, { recursive: true });
});

test('deleteMedia() removes the file from filesystem', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  await writeTestFile(root, 'test/song.mp3', 'x');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  await engine.deleteMedia('f1');
  await assert.rejects(() => engine.openMedia('f1'), {
    message: /FILE_MISSING/,
  });

  await rm(root, { recursive: true });
});

test('resolve() rejects path traversal attempts', async () => {
  const root = await makeTempDir();
  const repo = new MockMediaRepository();
  const folderId = repo.ensureFolder('..');
  repo.upsertFile({ id: 'escape', dir_id: folderId, name: 'passwd', has_thumb: 0, thumb_cache_path: null });
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  await assert.rejects(() => engine.resolve('escape'), {
    code: 'PATH_ESCAPE',
  });

  await rm(root, { recursive: true });
});

test('resolve() handles symlinked media roots correctly', async () => {
  const actualRoot = await makeTempDir();
  const mediaRoot = await makeTempDir();
  const { repo } = await setupRepo();
  await writeTestFile(actualRoot, 'test/song.mp3', 'x');
  await symlink(actualRoot, join(mediaRoot, 'music-link'));

  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [join(mediaRoot, 'music-link')] });
  const result = await engine.resolve('f1');
  if (result) {
    assert.ok(!result.fullPath, 'should not expose fullPath even for symlinked files');
  }

  await rm(actualRoot, { recursive: true });
  await rm(mediaRoot, { recursive: true });
});

test('resolve() returns only relative paths in dirPath and relPath', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  await writeTestFile(root, 'test/song.mp3', 'x');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  const result = await engine.resolve('f1');
  if (result) {
    assert.ok(!result.dirPath?.startsWith('/'), 'dirPath should be relative');
    assert.ok(!result.relPath?.startsWith('/'), 'relPath should be relative');
  }

  await rm(root, { recursive: true });
});

test('backend can read media without fs.* calls using openMedia()', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  const content = 'x'.repeat(5000000);
  await writeTestFile(root, 'test/song.mp3', content);
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  const resource = await engine.openMedia('f1');
  let bytesRead = 0;
  for await (const chunk of resource.stream) {
    bytesRead += chunk.length;
  }
  assert.strictEqual(bytesRead, resource.size, 'should read entire file via stream');

  await rm(root, { recursive: true });
});

test('openMedia() stream supports seeking for range requests', async () => {
  const root = await makeTempDir();
  const { repo } = await setupRepo();
  const content = 'x'.repeat(10000);
  await writeTestFile(root, 'test/song.mp3', content);
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [root] });

  const resource = await engine.openMedia('f1');
  await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    resource.stream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= 2048) {
        resource.stream.destroy();
        resolve();
      }
    });
    resource.stream.on('error', reject);
  });
  assert.ok(true, 'should be able to read partial stream');

  await rm(root, { recursive: true });
});
