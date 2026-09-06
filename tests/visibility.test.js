import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  ensureTables,
  getVisibility,
  setVisibility,
  isVisible,
  getChanges,
} from '../src/visibility/visibility.js';
import { MockMediaRepository } from '../src/repository/MockMediaRepository.js';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('ensureVisibilityTables creates tables', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('media_visibility','media_changes')"
  ).all();
  const tableNames = tables.map(t => t.name);
  assert.ok(tableNames.includes('media_visibility'));
  assert.ok(tableNames.includes('media_changes'));

  const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_media_changes_web'"
  ).all();
  assert.strictEqual(indexes.length, 1);

  db.close();
});

test('getVisibility returns PRESENT when no row exists', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  const state = getVisibility(db, 'file-1', 'web-1');
  assert.strictEqual(state, 'PRESENT');

  db.close();
});

test('setVisibility creates a new visibility row', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  const result = setVisibility(db, 'file-1', 'web-1', 'BLOCKED');

  assert.ok(result.changeId, 'changeId should be set');
  assert.strictEqual(result.previous, 'PRESENT');
  assert.strictEqual(result.next, 'BLOCKED');

  const state = getVisibility(db, 'file-1', 'web-1');
  assert.strictEqual(state, 'BLOCKED');

  db.close();
});

test('setVisibility with same state returns already without writing', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  setVisibility(db, 'file-1', 'web-1', 'BLOCKED');
  const result = setVisibility(db, 'file-1', 'web-1', 'BLOCKED');

  assert.strictEqual(result.changeId, null);
  assert.strictEqual(result.already, 'BLOCKED');

  const changesBefore = getChanges(db, 'web-1');
  assert.strictEqual(changesBefore.length, 1);

  db.close();
});

test('setVisibility with different state updates and returns changeId', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  setVisibility(db, 'file-1', 'web-1', 'DELETED');
  const result = setVisibility(db, 'file-1', 'web-1', 'HIDDEN');

  assert.ok(result.changeId, 'changeId should be set on state change');
  assert.strictEqual(result.previous, 'DELETED');
  assert.strictEqual(result.next, 'HIDDEN');

  const state = getVisibility(db, 'file-1', 'web-1');
  assert.strictEqual(state, 'HIDDEN');

  const changes = getChanges(db, 'web-1');
  assert.strictEqual(changes.length, 2);
  const hidden = changes.find(c => c.new_state === 'HIDDEN');
  assert.ok(hidden, 'HIDDEN change should exist');
  assert.strictEqual(hidden.previous_state, 'DELETED');

  db.close();
});

test('isVisible returns true for PRESENT', () => {
  const db = new Database(':memory:');
  ensureTables(db);
  setVisibility(db, 'file-1', 'web-1', 'PRESENT');

  assert.strictEqual(isVisible(db, 'file-1', 'web-1'), true);

  db.close();
});

test('isVisible returns false for BLOCKED', () => {
  const db = new Database(':memory:');
  ensureTables(db);
  setVisibility(db, 'file-1', 'web-1', 'BLOCKED');

  assert.strictEqual(isVisible(db, 'file-1', 'web-1'), false);

  db.close();
});

test('isVisible returns false for HIDDEN', () => {
  const db = new Database(':memory:');
  ensureTables(db);
  setVisibility(db, 'file-1', 'web-1', 'HIDDEN');

  assert.strictEqual(isVisible(db, 'file-1', 'web-1'), false);

  db.close();
});

test('isVisible returns true when webId is null/empty', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  assert.strictEqual(isVisible(db, 'file-1', null), true);
  assert.strictEqual(isVisible(db, 'file-1', ''), true);

  db.close();
});

test('getChanges returns only changes for the given webId', () => {
  const db = new Database(':memory:');
  ensureTables(db);

  setVisibility(db, 'file-1', 'web-A', 'BLOCKED');
  setVisibility(db, 'file-1', 'web-B', 'BLOCKED');
  setVisibility(db, 'file-1', 'web-A', 'PRESENT');

  const changesA = getChanges(db, 'web-A');
  assert.strictEqual(changesA.length, 2);
  assert.ok(changesA.every(c => c.web_id === 'web-A'));

  const changesB = getChanges(db, 'web-B');
  assert.strictEqual(changesB.length, 1);
  assert.strictEqual(changesB[0].web_id, 'web-B');

  db.close();
});

test('getChanges filters by sinceTimestamp', async () => {
  const db = new Database(':memory:');
  ensureTables(db);

  setVisibility(db, 'file-1', 'web-1', 'BLOCKED');
  await wait(20);
  const cutoff = Date.now();
  await wait(20);
  setVisibility(db, 'file-1', 'web-1', 'PRESENT');

  const allChanges = getChanges(db, 'web-1');
  assert.strictEqual(allChanges.length, 2);

  const recentChanges = getChanges(db, 'web-1', cutoff);
  assert.strictEqual(recentChanges.length, 1);
  assert.strictEqual(recentChanges[0].new_state, 'PRESENT');

  db.close();
});

test('MockMediaRepository visibility: getVisibilityState returns PRESENT by default', () => {
  const repo = new MockMediaRepository();
  assert.strictEqual(repo.getVisibilityState('f1', 'w1'), 'PRESENT');
});

test('MockMediaRepository visibility: setVisibilityState creates and returns changeId', () => {
  const repo = new MockMediaRepository();
  const result = repo.setVisibilityState('f1', 'w1', 'BLOCKED');

  assert.ok(result.changeId);
  assert.strictEqual(result.previous, 'PRESENT');
  assert.strictEqual(result.next, 'BLOCKED');
  assert.strictEqual(repo.getVisibilityState('f1', 'w1'), 'BLOCKED');
});

test('MockMediaRepository visibility: setVisibilityState with same state returns already', () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w1', 'BLOCKED');
  const result = repo.setVisibilityState('f1', 'w1', 'BLOCKED');

  assert.strictEqual(result.changeId, null);
  assert.strictEqual(result.already, 'BLOCKED');
  assert.strictEqual(repo.getChanges('w1').length, 1);
});

test('MockMediaRepository visibility: setVisibilityState with different state updates', () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w1', 'DELETED');
  const result = repo.setVisibilityState('f1', 'w1', 'HIDDEN');

  assert.ok(result.changeId);
  assert.strictEqual(result.previous, 'DELETED');
  assert.strictEqual(result.next, 'HIDDEN');
  assert.strictEqual(repo.getVisibilityState('f1', 'w1'), 'HIDDEN');
  assert.strictEqual(repo.getChanges('w1').length, 2);
});

test('MockMediaRepository visibility: isVisible returns true for PRESENT', () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w1', 'PRESENT');
  assert.strictEqual(repo.isVisible('f1', 'w1'), true);
});

test('MockMediaRepository visibility: isVisible returns false for BLOCKED', () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w1', 'BLOCKED');
  assert.strictEqual(repo.isVisible('f1', 'w1'), false);
});

test('MockMediaRepository visibility: isVisible returns false for HIDDEN', () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w1', 'HIDDEN');
  assert.strictEqual(repo.isVisible('f1', 'w1'), false);
});

test('MockMediaRepository visibility: isVisible returns true when webId is null/empty', () => {
  const repo = new MockMediaRepository();
  assert.strictEqual(repo.isVisible('f1', null), true);
  assert.strictEqual(repo.isVisible('f1', ''), true);
});

test('MockMediaRepository visibility: getChanges filters by webId', () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w-A', 'BLOCKED');
  repo.setVisibilityState('f1', 'w-B', 'BLOCKED');
  repo.setVisibilityState('f1', 'w-A', 'PRESENT');

  assert.strictEqual(repo.getChanges('w-A').length, 2);
  assert.strictEqual(repo.getChanges('w-B').length, 1);
});

test('MockMediaRepository visibility: getChanges filters by sinceTimestamp', async () => {
  const repo = new MockMediaRepository();
  repo.setVisibilityState('f1', 'w1', 'BLOCKED');
  await wait(20);

  const cutoff = Date.now();
  await wait(20);

  repo.setVisibilityState('f1', 'w1', 'PRESENT');

  assert.strictEqual(repo.getChanges('w1').length, 2);
  assert.strictEqual(repo.getChanges('w1', cutoff).length, 1);
});
