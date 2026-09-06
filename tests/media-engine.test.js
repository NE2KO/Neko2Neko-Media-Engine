import { test } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { MediaEngine } from '../src/MediaEngine.js';
import { MockMediaRepository } from '../src/repository/MockMediaRepository.js';

const WEB_ID = 'web-1';
let tempDir;

function setupRepo() {
  const repo = new MockMediaRepository();
  const folderId = repo.ensureFolder('test');
  repo.upsertFile({ id: 'f1', dir_id: folderId, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  repo.upsertFile({ id: 'f2', dir_id: folderId, name: 'vid.mp4', type: 'video', ext: '.mp4', size: 50000000, mtime: Date.now(), created_at: Date.now() });
  return { repo, folderId };
}

test.beforeEach(() => {
  tempDir = `/tmp/media-engine-test-${Date.now()}`;
  mkdirSync(`${tempDir}/test`, { recursive: true });
  writeFileSync(`${tempDir}/test/song.mp3`, 'x');
  writeFileSync(`${tempDir}/test/vid.mp4`, 'x');
});

test.afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('resolve returns null for missing file', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.resolve('nonexistent');
  assert.strictEqual(result, null);
});

test('resolve returns file metadata WITHOUT fullPath for existing file', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.resolve('f1');
  assert.ok(result !== null);
  assert.strictEqual(result.id, 'f1');
  assert.strictEqual(result.name, 'song.mp3');
  assert.strictEqual(result.type, 'audio');
  assert.strictEqual(result.ext, '.mp3');
  assert.strictEqual(result.size, 5000000);
  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.fullPath, undefined);
  assert.strictEqual(result.relPath, 'test/song.mp3');
  assert.strictEqual(result.dirPath, 'test');
  assert.ok(typeof result.dir_id === 'string');
});

test('getServeTarget returns resource object with stream and headers for visible file', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.getServeTarget('f1');
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.exists, undefined);
  assert.ok(result.stream !== undefined);
  assert.strictEqual(result.path, undefined);
  assert.strictEqual(result.size, 5000000);
  assert.strictEqual(result.mimeType, 'audio/mpeg');
  assert.strictEqual(result.etag, 'f1');
  assert.ok(typeof result.lastModified === 'number');
  assert.deepStrictEqual(result.headers, {
    'Cache-Control': 'public, max-age=86400, immutable',
    'Accept-Ranges': 'bytes',
  });
  await new Promise((resolve, reject) => {
    result.stream.on('error', reject);
    result.stream.on('close', resolve);
    result.stream.on('end', resolve);
    result.stream.destroy();
  });
});

test('getServeTarget returns not_found for missing file', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.getServeTarget('nonexistent');
  assert.strictEqual(result.error, 'not_found');
});

test('stat returns size and mtime for existing file', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.stat('f1');
  assert.ok(result !== null);
  assert.strictEqual(result.size, 5000000);
  assert.ok(typeof result.mtime === 'number');
  assert.strictEqual(result.exists, true);
});

test('stat returns null for missing file', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.stat('nonexistent');
  assert.strictEqual(result, null);
});

test('isVisible returns true for file without visibility row', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  assert.strictEqual(engine.isVisible('f1'), true);
});

test('isVisible returns false for BLOCKED file', async () => {
  const { repo } = setupRepo();
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  assert.strictEqual(engine.isVisible('f1'), false);
});

test('delete sets visibility to DELETED', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = engine.delete('f1');
  assert.strictEqual(result.state, 'DELETED');
  assert.strictEqual(result.operation, 'DELETE');
  assert.strictEqual(result.webId, WEB_ID);
  assert.strictEqual(result.fileId, 'f1');
});

test('restore sets visibility to PRESENT', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const result = engine.restore('f1');
  assert.strictEqual(result.state, 'PRESENT');
  assert.strictEqual(result.operation, 'RESTORE');
  assert.strictEqual(result.webId, WEB_ID);
  assert.strictEqual(result.fileId, 'f1');
});

test('listFiles returns files filtered by folderId', async () => {
  const { repo, folderId } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.listFiles({ folderId });
  assert.strictEqual(result.items.length, 2);
  assert.ok(result.items.every(f => f.dir_id === folderId));
});

test('listFiles returns files filtered by type', async () => {
  const { repo, folderId } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.listFiles({ folderId, type: 'audio' });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].type, 'audio');
});

test('listFiles respects limit', async () => {
  const { repo, folderId } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.listFiles({ folderId, limit: 1 });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.limit, 1);
  assert.strictEqual(result.total, 2);
});

test('searchFiles returns matching files by name', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.searchFiles('song');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'song.mp3');
});

test('searchFiles respects type filter', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.searchFiles('vid', { type: 'audio' });
  assert.strictEqual(result.length, 0);
});

test('getStats returns totalFiles and byType', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const stats = await engine.getStats();
  assert.strictEqual(stats.totalFiles, 2);
  assert.strictEqual(stats.byType.audio, 1);
  assert.strictEqual(stats.byType.video, 1);
});

test('getBatchFiles returns items and missingIds', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.getBatchFiles(['f1', 'f2', 'missing']);
  assert.strictEqual(result.items.length, 2);
  assert.deepStrictEqual(result.missingIds, ['missing']);
});

test('getFileMetadata returns full metadata', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const meta = await engine.getFileMetadata('f1');
  assert.ok(meta !== null);
  assert.strictEqual(meta.id, 'f1');
  assert.strictEqual(meta.name, 'song.mp3');
  assert.strictEqual(meta.type, 'audio');
  assert.strictEqual(meta.ext, '.mp3');
  assert.strictEqual(meta.size, 5000000);
  assert.strictEqual(meta.visibility, 'PRESENT');
});

test('updateMetadata updates isFavorite', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  await engine.updateMetadata('f1', { isFavorite: true });
  const meta = await engine.getFileMetadata('f1');
  assert.strictEqual(meta.isFavorite, true);
});

test('updateMetadata rejects unknown fields', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.updateMetadata('f1', { unknownField: 'value' });
  assert.strictEqual(result.ok, true);
  const file = repo.getFileById('f1');
  assert.strictEqual(file.unknownField, undefined);
});

test('getFolder returns folder info', async () => {
  const { repo, folderId } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const folder = await engine.getFolder(folderId);
  assert.ok(folder !== null);
  assert.strictEqual(folder.id, folderId);
  assert.strictEqual(folder.path, 'test');
});

test('getFolder returns null for missing folder', async () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const folder = await engine.getFolder('nonexistent');
  assert.strictEqual(folder, null);
});

test('listFavorites returns favorite files', async () => {
  const repo = new MockMediaRepository();
  const folderId = repo.ensureFolder('test');
  repo.upsertFile({ id: 'f1', dir_id: folderId, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now(), is_favorite: 1 });
  repo.upsertFile({ id: 'f2', dir_id: folderId, name: 'vid.mp4', type: 'video', ext: '.mp4', size: 50000000, mtime: Date.now(), created_at: Date.now(), is_favorite: 1 });
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const favs = await engine.listFavorites();
  assert.strictEqual(favs.length, 2);
  assert.ok(favs.some(f => f.file_id === 'f1' && f.type === 'audio'));
  assert.ok(favs.some(f => f.file_id === 'f2' && f.type === 'video'));
});

test('resolve returns blocked file with reason', async () => {
  const { repo } = setupRepo();
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.resolve('f1');
  assert.ok(result !== null);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.reason, 'deleted');
  assert.strictEqual(result.fullPath, undefined);
});

test('getServeTarget returns not_available for blocked file', async () => {
  const { repo } = setupRepo();
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo, mediaRoots: [tempDir] });
  const result = await engine.getServeTarget('f1');
  assert.strictEqual(result.error, 'not_available');
});
