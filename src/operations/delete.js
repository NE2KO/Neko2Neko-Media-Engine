export function logicalDelete(db, fileId, webId) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO media_visibility (file_id, web_id, state, updated_at)
    VALUES (?, ?, 'DELETED', ?)
    ON CONFLICT(file_id, web_id) DO UPDATE SET state = 'DELETED', updated_at = ?
  `).run(fileId, webId, now, now);
  return { changeId: crypto.randomUUID(), operation: 'DELETE', fileId };
}
