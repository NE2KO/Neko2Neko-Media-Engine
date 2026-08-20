import { getVisibility, setVisibility } from './visibility.js';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS media_changesets (
    changeset_id TEXT PRIMARY KEY,
    web_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    state TEXT NOT NULL DEFAULT 'DRAFT',
    created_at INTEGER NOT NULL,
    finalized_at INTEGER,
    applied_at INTEGER,
    applied_by TEXT,
    promotion_source TEXT,
    promotion_target TEXT
  )
`;

const CREATE_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS media_changeset_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    changeset_id TEXT NOT NULL,
    change_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    FOREIGN KEY (changeset_id) REFERENCES media_changesets(changeset_id)
  )
`;

const CREATE_ITEMS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_changeset_items_changeset
    ON media_changeset_items(changeset_id)
`;

export const ENVIRONMENT_ORDER = {
  'beta': 0,
  'pre-release': 1,
  'pre': 1,
  'release': 2,
};

export function ensureChangesetTables(db) {
  db.exec(CREATE_TABLE);
  db.exec(CREATE_ITEMS_TABLE);
  db.exec(CREATE_ITEMS_INDEX);
  try { db.prepare('ALTER TABLE media_changesets ADD COLUMN promotion_source TEXT'); } catch (e) {}
  try { db.prepare('ALTER TABLE media_changesets ADD COLUMN promotion_target TEXT'); } catch (e) {}
}

export function createChangeset(db, webId, name = '', description = '') {
  const changeset_id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO media_changesets (changeset_id, web_id, name, description, state, created_at)
    VALUES (?, ?, ?, ?, 'DRAFT', ?)
  `).run(changeset_id, webId, name || null, description || null, now);
  return { changeset_id, webId, name, description, state: 'DRAFT', created_at: now };
}

export function finalizeChangeset(db, changeset_id) {
  const now = Date.now();
  const result = db.prepare(`
    UPDATE media_changesets SET state = 'FINALIZED', finalized_at = ?
    WHERE changeset_id = ? AND state = 'DRAFT'
  `).run(now, changeset_id);
  if (result.changes === 0) {
    const cs = db.prepare('SELECT state FROM media_changesets WHERE changeset_id = ?').get(changeset_id);
    const state = cs ? cs.state : 'NOT_FOUND';
    throw new Error(`Cannot finalize changeset ${changeset_id}: current state is ${state}`);
  }
  return { changeset_id, state: 'FINALIZED', finalized_at: now };
}

export function addChangeToChangeset(db, changeset_id, change_id) {
  const cs = db.prepare('SELECT state FROM media_changesets WHERE changeset_id = ?').get(changeset_id);
  if (!cs) throw new Error(`Changeset ${changeset_id} not found`);
  if (cs.state !== 'DRAFT') throw new Error(`Cannot add to changeset in state ${cs.state}`);
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO media_changeset_items (changeset_id, change_id, added_at)
    VALUES (?, ?, ?)
  `).run(changeset_id, change_id, now);
  return { changeset_id, change_id, added: true };
}

export function getChangeset(db, changeset_id) {
  const cs = db.prepare('SELECT * FROM media_changesets WHERE changeset_id = ?').get(changeset_id);
  if (!cs) return null;
  const items = db.prepare(`
    SELECT c.change_id, c.operation, c.file_id, c.previous_state, c.new_state, c.created_at
    FROM media_changeset_items i
    JOIN media_changes c ON i.change_id = c.change_id
    WHERE i.changeset_id = ?
    ORDER BY i.added_at ASC
  `).all(changeset_id);
  return { ...cs, items };
}

export function listChangesets(db, webId, stateFilter = null) {
  if (stateFilter) {
    return db.prepare(`
      SELECT * FROM media_changesets WHERE web_id = ? AND state = ? ORDER BY created_at DESC
    `).all(webId, stateFilter);
  }
  return db.prepare(`
    SELECT * FROM media_changesets WHERE web_id = ? ORDER BY created_at DESC
  `).all(webId);
}

export function validatePromotionPath(sourceWebId, targetWebId) {
  const sourceOrder = ENVIRONMENT_ORDER[sourceWebId];
  const targetOrder = ENVIRONMENT_ORDER[targetWebId];
  if (sourceOrder === undefined || targetOrder === undefined) {
    throw new Error(`Unknown environment: source=${sourceWebId}, target=${targetWebId}`);
  }
  if (sourceOrder + 1 !== targetOrder) {
    throw new Error(
      `Invalid promotion path: ${sourceWebId} (${sourceOrder}) -> ${targetWebId} (${targetOrder}). ` +
      `Only sequential promotion is allowed (beta->pre, pre->release).`
    );
  }
  return true;
}

export function detectConflicts(sourceDb, changeset_id, targetWebId, targetDb) {
  const cs = sourceDb.prepare('SELECT * FROM media_changesets WHERE changeset_id = ?').get(changeset_id);
  if (!cs) throw new Error(`Changeset ${changeset_id} not found`);

  const items = sourceDb.prepare(`
    SELECT c.change_id, c.operation, c.file_id, c.previous_state, c.new_state
    FROM media_changeset_items i
    JOIN media_changes c ON i.change_id = c.change_id
    WHERE i.changeset_id = ?
  `).all(changeset_id);

  const conflicts = [];
  for (const item of items) {
    const targetState = getVisibility(targetDb, item.file_id, targetWebId);
    const expectedState = item.previous_state;

    if (targetState !== expectedState) {
      conflicts.push({
        fileId: item.file_id,
        changeId: item.change_id,
        operation: item.operation,
        expectedState,
        actualState: targetState,
        reason: `Target environment has state '${targetState}' but changeset expects '${expectedState}'`,
      });
    }
  }
  return conflicts;
}

export function applyChangeset(sourceDb, changeset_id, targetWebId, targetDb) {
  const cs = sourceDb.prepare('SELECT * FROM media_changesets WHERE changeset_id = ?').get(changeset_id);
  if (!cs) throw new Error(`Changeset ${changeset_id} not found`);
  if (cs.state !== 'FINALIZED') throw new Error(`Cannot apply changeset in state ${cs.state}`);

  validatePromotionPath(cs.web_id, targetWebId);

  const conflicts = detectConflicts(sourceDb, changeset_id, targetWebId, targetDb);
  if (conflicts.length > 0) {
    const conflictSummary = conflicts.map(c => `${c.fileId}: expected ${c.expectedState}, got ${c.actualState}`).join('; ');
    throw new Error(`Conflicts detected before apply: ${conflictSummary}`);
  }

  const items = sourceDb.prepare(`
    SELECT c.change_id, c.operation, c.file_id, c.previous_state, c.new_state, c.web_id as source_web_id
    FROM media_changeset_items i
    JOIN media_changes c ON i.change_id = c.change_id
    WHERE i.changeset_id = ?
  `).all(changeset_id);

  for (const item of items) {
    if (item.operation === 'DELETE') {
      setVisibility(targetDb, item.file_id, targetWebId, 'DELETED', item.source_web_id);
    } else if (item.operation === 'RESTORE') {
      setVisibility(targetDb, item.file_id, targetWebId, 'PRESENT', item.source_web_id);
    }
  }

  const now = Date.now();
  const result = sourceDb.prepare(`
    UPDATE media_changesets SET state = 'APPLIED', applied_at = ?, applied_by = ?, promotion_source = ?, promotion_target = ?
    WHERE changeset_id = ? AND state = 'FINALIZED'
  `).run(now, targetWebId, cs.web_id, targetWebId, changeset_id);
  if (result.changes === 0) {
    const current = sourceDb.prepare('SELECT state FROM media_changesets WHERE changeset_id = ?').get(changeset_id);
    throw new Error(`Failed to apply changeset ${changeset_id}: current state is ${current?.state || 'UNKNOWN'}`);
  }

  return {
    changeset_id,
    state: 'APPLIED',
    applied_at: now,
    applied_by: targetWebId,
    promotion_source: cs.web_id,
    promotion_target: targetWebId,
    appliedChanges: items.length,
  };
}
