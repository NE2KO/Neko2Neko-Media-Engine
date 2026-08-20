const CREATE_VISIBILITY_TABLE = `
  CREATE TABLE IF NOT EXISTS media_visibility (
    file_id TEXT NOT NULL,
    web_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PRESENT',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (file_id, web_id)
  )
`;

const CREATE_CHANGES_TABLE = `
  CREATE TABLE IF NOT EXISTS media_changes (
    change_id TEXT PRIMARY KEY,
    web_id TEXT NOT NULL,
    file_id TEXT,
    operation TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )
`;

const CREATE_CHANGES_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_media_changes_web
    ON media_changes(web_id, created_at DESC)
`;

export function ensureTables(db) {
  db.exec(CREATE_VISIBILITY_TABLE);
  db.exec(CREATE_CHANGES_TABLE);
  db.exec(CREATE_CHANGES_INDEX);
}

export function getVisibility(db, fileId, webId) {
  const row = db.prepare(
    'SELECT state FROM media_visibility WHERE file_id = ? AND web_id = ?'
  ).get(fileId, webId);
  return row ? row.state : 'PRESENT';
}

export function setVisibility(db, fileId, webId, state, payload = null) {
  const now = Date.now();
  const previous = getVisibility(db, fileId, webId);
  if (previous === state) {
    return { changeId: null, already: state };
  }
  const changeId = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO media_visibility (file_id, web_id, state, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_id, web_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
    `).run(fileId, webId, state, now);
    db.prepare(`
      INSERT INTO media_changes (change_id, web_id, file_id, operation, previous_state, new_state, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      changeId,
      webId,
      fileId,
      state === 'DELETED' ? 'DELETE' : 'RESTORE',
      previous,
      state,
      payload ? JSON.stringify(payload) : null,
      now
    );
  });
  tx();
  return { changeId, previous, next: state };
}

export function isVisible(db, fileId, webId) {
  return getVisibility(db, fileId, webId) === 'PRESENT';
}

export function getChanges(db, webId, sinceTimestamp = 0) {
  return db.prepare(
    `SELECT change_id, web_id, file_id, operation, previous_state, new_state, payload, created_at
     FROM media_changes
     WHERE web_id = ? AND created_at > ?
     ORDER BY created_at ASC`
  ).all(webId, sinceTimestamp);
}
