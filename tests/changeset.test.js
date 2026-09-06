import { test } from 'node:test';
import assert from 'node:assert';
import { MediaEngine } from '../src/MediaEngine.js';
import { MockMediaRepository } from '../src/repository/MockMediaRepository.js';

const WEB_ID = 'web-1';
const TARGET_WEB_ID = 'web-2';

function setupRepo() {
  const repo = new MockMediaRepository();
  const folderId = repo.ensureFolder('test');
  repo.upsertFile({ id: 'f1', dir_id: folderId, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  repo.upsertFile({ id: 'f2', dir_id: folderId, name: 'vid.mp4', type: 'video', ext: '.mp4', size: 50000000, mtime: Date.now(), created_at: Date.now() });
  return { repo, folderId };
}

test('createChangeset returns a new changeset in DRAFT state', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  const cs = engine.createChangeset('cs1', 'Test changeset');
  assert.strictEqual(cs.state, 'DRAFT');
  assert.strictEqual(cs.webId, WEB_ID);
  assert.strictEqual(cs.name, 'cs1');
});

test('finalizeChangeset moves to FINALIZED', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  const cs = engine.createChangeset('cs1', 'Test changeset');
  const finalized = engine.finalizeChangeset(cs.changeset_id);
  assert.strictEqual(finalized.state, 'FINALIZED');
});

test('finalizeChangeset throws for non-existent changeset', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  assert.throws(() => engine.finalizeChangeset('nonexistent'), /Changeset nonexistent not found/);
});

test('finalizeChangeset throws for already finalized changeset', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  const cs = engine.createChangeset('cs1', 'Test changeset');
  engine.finalizeChangeset(cs.changeset_id);
  assert.throws(() => engine.finalizeChangeset(cs.changeset_id), /Cannot finalize changeset in state FINALIZED/);
});

test('addChangeToChangeset adds a change to a draft changeset', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = repo._changes[repo._changes.length - 1].changeId;
  const cs = engine.createChangeset('cs1', 'Test changeset');
  const result = engine.addToChangeset(cs.changeset_id, changeId);
  assert.strictEqual(result.added, true);
  assert.strictEqual(result.changeset_id, cs.changeset_id);
  assert.strictEqual(result.change_id, changeId);
  const stored = repo._changesets.get(cs.changeset_id);
  assert.ok(stored.items.includes(changeId));
});

test('addChangeToChangeset throws for finalized changeset', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = repo._changes[repo._changes.length - 1].changeId;
  const cs = engine.createChangeset('cs1', 'Test changeset');
  engine.finalizeChangeset(cs.changeset_id);
  assert.throws(() => engine.addToChangeset(cs.changeset_id, changeId), /Cannot add to changeset in state FINALIZED/);
});

test('addChangeToChangeset ignores duplicate adds', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = repo._changes[repo._changes.length - 1].changeId;
  const cs = engine.createChangeset('cs1', 'Test changeset');
  engine.addToChangeset(cs.changeset_id, changeId);
  engine.addToChangeset(cs.changeset_id, changeId);
  const stored = repo._changesets.get(cs.changeset_id);
  assert.strictEqual(stored.items.length, 1);
});

test('getChangeset returns full changeset with items', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: WEB_ID, repository: repo });
  repo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = repo._changes[repo._changes.length - 1].changeId;
  const cs = engine.createChangeset('cs1', 'Test changeset');
  engine.addToChangeset(cs.changeset_id, changeId);
  const full = engine.inspectChangeset(cs.changeset_id);
  assert.ok(full !== null);
  assert.strictEqual(full.state, 'DRAFT');
  assert.strictEqual(full.items.length, 1);
  assert.strictEqual(full.items[0].changeId, changeId);
});

test('listChangesets returns only changesets for the given webId', () => {
  const { repo } = setupRepo();
  const engine1 = new MediaEngine({ webId: WEB_ID, repository: repo });
  const engine2 = new MediaEngine({ webId: TARGET_WEB_ID, repository: repo });
  engine1.createChangeset('cs1', 'For web-1');
  engine2.createChangeset('cs2', 'For web-2');
  const list = engine1.listChangesets();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].web_id, WEB_ID);
});

test('validatePromotionPath allows beta -> pre-release', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: 'beta', repository: repo });
  assert.doesNotThrow(() => engine.validatePromotion('pre-release'));
});

test('validatePromotionPath rejects invalid jumps', () => {
  const { repo } = setupRepo();
  const engine = new MediaEngine({ webId: 'beta', repository: repo });
  assert.throws(() => engine.validatePromotion('release'), /Invalid promotion path/);
});

test('detectConflicts finds conflicts when target state differs', () => {
  const sourceRepo = new MockMediaRepository();
  const targetRepo = new MockMediaRepository();
  const folderId1 = sourceRepo.ensureFolder('test');
  const folderId2 = targetRepo.ensureFolder('test');
  sourceRepo.upsertFile({ id: 'f1', dir_id: folderId1, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  targetRepo.upsertFile({ id: 'f1', dir_id: folderId2, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });

  sourceRepo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = sourceRepo._changes[sourceRepo._changes.length - 1].changeId;

  targetRepo.setVisibilityState('f1', TARGET_WEB_ID, 'DELETED');

  const cs = sourceRepo.createChangeset(WEB_ID, 'cs1', 'Test');
  sourceRepo.addChangeToChangeset(cs.changeset_id, changeId);

  const conflicts = sourceRepo.detectConflicts(cs.changeset_id, TARGET_WEB_ID, targetRepo);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].fileId, 'f1');
});

test('applyChangeset applies changes to target repository', () => {
  const sourceRepo = new MockMediaRepository();
  const targetRepo = new MockMediaRepository();
  const folderId1 = sourceRepo.ensureFolder('test');
  const folderId2 = targetRepo.ensureFolder('test');
  sourceRepo.upsertFile({ id: 'f1', dir_id: folderId1, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  targetRepo.upsertFile({ id: 'f1', dir_id: folderId2, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });

  sourceRepo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = sourceRepo._changes[sourceRepo._changes.length - 1].changeId;

  const cs = sourceRepo.createChangeset(WEB_ID, 'cs1', 'Test');
  sourceRepo.addChangeToChangeset(cs.changeset_id, changeId);
  sourceRepo.finalizeChangeset(cs.changeset_id);

  const result = sourceRepo.applyChangeset(cs.changeset_id, TARGET_WEB_ID, targetRepo);
  assert.strictEqual(result.state, 'APPLIED');
  assert.strictEqual(result.appliedChanges, 1);
  assert.strictEqual(targetRepo.getVisibilityState('f1', TARGET_WEB_ID), 'DELETED');
});

test('applyChangeset throws on conflicts', () => {
  const sourceRepo = new MockMediaRepository();
  const targetRepo = new MockMediaRepository();
  const folderId1 = sourceRepo.ensureFolder('test');
  const folderId2 = targetRepo.ensureFolder('test');
  sourceRepo.upsertFile({ id: 'f1', dir_id: folderId1, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  targetRepo.upsertFile({ id: 'f1', dir_id: folderId2, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });

  sourceRepo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = sourceRepo._changes[sourceRepo._changes.length - 1].changeId;
  targetRepo.setVisibilityState('f1', TARGET_WEB_ID, 'DELETED');

  const cs = sourceRepo.createChangeset(WEB_ID, 'cs1', 'Test');
  sourceRepo.addChangeToChangeset(cs.changeset_id, changeId);
  sourceRepo.finalizeChangeset(cs.changeset_id);

  assert.throws(() => sourceRepo.applyChangeset(cs.changeset_id, TARGET_WEB_ID, targetRepo), /Conflicts detected/);
});

test('applyChangeset throws if not finalized', () => {
  const sourceRepo = new MockMediaRepository();
  const targetRepo = new MockMediaRepository();
  const folderId1 = sourceRepo.ensureFolder('test');
  const folderId2 = targetRepo.ensureFolder('test');
  sourceRepo.upsertFile({ id: 'f1', dir_id: folderId1, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });
  targetRepo.upsertFile({ id: 'f1', dir_id: folderId2, name: 'song.mp3', type: 'audio', ext: '.mp3', size: 5000000, mtime: Date.now(), created_at: Date.now() });

  sourceRepo.setVisibilityState('f1', WEB_ID, 'DELETED');
  const changeId = sourceRepo._changes[sourceRepo._changes.length - 1].changeId;

  const cs = sourceRepo.createChangeset(WEB_ID, 'cs1', 'Test');
  sourceRepo.addChangeToChangeset(cs.changeset_id, changeId);

  assert.throws(() => sourceRepo.applyChangeset(cs.changeset_id, TARGET_WEB_ID, targetRepo), /Cannot apply changeset in state DRAFT/);
});
