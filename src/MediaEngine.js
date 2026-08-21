import { resolveFile } from './resolver/resolveFile.js';
import { ensureTables, isVisible, setVisibility, getChanges } from './visibility/visibility.js';
import {
  ensureChangesetTables,
  createChangeset,
  finalizeChangeset,
  addChangeToChangeset,
  getChangeset,
  listChangesets,
  applyChangeset,
  validatePromotionPath,
  detectConflicts,
  ENVIRONMENT_ORDER,
} from './visibility/changeset.js';

const SORT_CLAUSE = {
  created_at: { asc: 'f.created_at ASC, f.id ASC', desc: 'f.created_at DESC, f.id DESC' },
  name:       { asc: 'LOWER(f.name) ASC, f.id ASC', desc: 'LOWER(f.name) DESC, f.id DESC' },
  mtime:      { asc: 'f.mtime ASC, f.id ASC',      desc: 'f.mtime DESC, f.id DESC' },
  size:       { asc: 'f.size ASC, f.id ASC',       desc: 'f.size DESC, f.id DESC' },
};

export class MediaEngine {
  constructor({ webId, db, stmts, mediaRoots }) {
    if (!webId) {
      throw new Error('WEB_ID is required for MediaEngine');
    }
    this.webId = webId;
    this.db = db;
    this.stmts = stmts;
    this.mediaRoots = Array.isArray(mediaRoots) ? mediaRoots : [mediaRoots];
    ensureTables(db);
    ensureChangesetTables(db);
  }

  async resolve(fileId) {
    const file = await resolveFile(fileId, this.stmts, this.mediaRoots);
    if (!file) return null;
    if (!isVisible(this.db, fileId, this.webId)) {
      return { ...file, blocked: true, reason: 'deleted' };
    }
    return file;
  }

  async getServeTarget(fileId) {
    const file = await this.resolve(fileId);
    if (!file) return { error: 'not_found' };
    if (file.blocked) return { error: 'not_available' };
    if (!file.exists) return { error: 'file_missing' };
    return {
      path: file.fullPath,
      exists: true,
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable',
        'Accept-Ranges': 'bytes',
      },
    };
  }

  async stat(fileId) {
    const file = await this.resolve(fileId);
    if (!file || file.blocked) return null;
    return {
      size: file.size,
      mtime: file.mtime,
      exists: file.exists,
    };
  }

  isVisible(fileId) {
    return isVisible(this.db, fileId, this.webId);
  }

  delete(fileId) {
    const result = setVisibility(this.db, fileId, this.webId, 'DELETED');
    if (result.already === 'DELETED') {
      return { changeId: null, fileId, webId: this.webId, operation: 'DELETE', state: 'DELETED', already: true };
    }
    return { changeId: result.changeId, fileId, webId: this.webId, operation: 'DELETE', state: 'DELETED', previous: result.previous };
  }

  restore(fileId) {
    const result = setVisibility(this.db, fileId, this.webId, 'PRESENT');
    if (result.already === 'PRESENT') {
      return { changeId: null, fileId, webId: this.webId, operation: 'RESTORE', state: 'PRESENT', already: true };
    }
    return { changeId: result.changeId, fileId, webId: this.webId, operation: 'RESTORE', state: 'PRESENT', previous: result.previous };
  }

  getChanges(sinceTimestamp = 0) {
    return getChanges(this.db, this.webId, sinceTimestamp);
  }

  createChangeset(name = '', description = '') {
    return createChangeset(this.db, this.webId, name, description);
  }

  finalizeChangeset(changeset_id) {
    return finalizeChangeset(this.db, changeset_id);
  }

  addToChangeset(changeset_id, change_id) {
    return addChangeToChangeset(this.db, changeset_id, change_id);
  }

  inspectChangeset(changeset_id) {
    return getChangeset(this.db, changeset_id);
  }

  listChangesets(stateFilter = null) {
    return listChangesets(this.db, this.webId, stateFilter);
  }

  validatePromotion(targetWebId) {
    return validatePromotionPath(this.webId, targetWebId);
  }

  ensureChangesetTables(db) {
    return ensureChangesetTables(db);
  }

  preflightApply(changeset_id, targetWebId, targetDb = null) {
    validatePromotionPath(this.webId, targetWebId);
    const cs = getChangeset(this.db, changeset_id);
    if (!cs) throw new Error(`Changeset ${changeset_id} not found`);
    if (cs.state !== 'FINALIZED') throw new Error(`Changeset must be FINALIZED, current: ${cs.state}`);
    const dbToUse = targetDb || this.db;
    const conflicts = detectConflicts(this.db, changeset_id, targetWebId, dbToUse);
    return {
      changeset: cs,
      promotionPath: { source: this.webId, target: targetWebId },
      conflicts,
      safeToApply: conflicts.length === 0,
    };
  }

  applyChangeset(changeset_id, targetWebId, targetDb = null) {
    const dbToUse = targetDb || this.db;
    return applyChangeset(this.db, changeset_id, targetWebId, dbToUse);
  }

  async listFiles({ folderId, limit = 100, offset = 0, sortBy = 'created_at', sortOrder = 'desc', type = null, favoriteOnly = false, cursor = null, prevCursor = null }) {
    const clauses = ['mv.state = "PRESENT"'];
    const params = [this.webId];
    if (folderId) {
      clauses.push('f.dir_id = ?');
      params.push(folderId);
    }
    if (type && ['video', 'audio', 'image'].includes(type)) {
      clauses.push('f.type = ?');
      params.push(type);
    }
    if (favoriteOnly) {
      clauses.push('f.is_favorite = 1');
    }
    const where = clauses.join(' AND ');
    const baseSelect = `SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration, f.created_at, f.uploaded_at, f.is_favorite, fo.path as dir_path FROM files f JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ? LEFT JOIN folders fo ON f.dir_id = fo.id`;

    let sql, queryParams;
    const queryLimit = limit + 1;

    if (prevCursor && sortBy === 'created_at' && sortOrder === 'desc') {
      const [pc, pid] = prevCursor.split('_');
      const pCreatedAt = parseInt(pc, 10) || 0;
      sql = `${baseSelect} WHERE ${where} AND (f.created_at < ? OR (f.created_at = ? AND f.id < ?)) ORDER BY f.created_at DESC, f.id DESC LIMIT ?`;
      queryParams = [...params, pCreatedAt, pCreatedAt, pid, queryLimit];
    } else if (cursor && sortBy === 'created_at' && sortOrder === 'desc') {
      const [cCreatedAt, cId] = cursor.split('_');
      const createdAtNum = parseInt(cCreatedAt, 10) || 0;
      sql = `${baseSelect} WHERE ${where} AND (f.created_at, f.id) < (?, ?) ORDER BY f.created_at DESC, f.id DESC LIMIT ?`;
      queryParams = [...params, createdAtNum, cId, queryLimit];
    } else if (cursor && sortBy === 'created_at' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.created_at > ? OR (f.created_at = ? AND f.id > ?)) ORDER BY f.created_at ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.created_at ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'mtime' && sortOrder === 'desc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.mtime < ? OR (f.mtime = ? AND f.id > ?)) ORDER BY f.mtime DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.mtime DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'mtime' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.mtime > ? OR (f.mtime = ? AND f.id > ?)) ORDER BY f.mtime ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.mtime ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'name' && sortOrder === 'desc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (LOWER(f.name) COLLATE NOCASE < ? OR (LOWER(f.name) COLLATE NOCASE = ? AND f.id > ?)) ORDER BY LOWER(f.name) DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY LOWER(f.name) DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'name' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (LOWER(f.name) COLLATE NOCASE > ? OR (LOWER(f.name) COLLATE NOCASE = ? AND f.id > ?)) ORDER BY LOWER(f.name) ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY LOWER(f.name) ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'size' && sortOrder === 'desc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.size < ? OR (f.size = ? AND f.id > ?)) ORDER BY f.size DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.size DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'size' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.size > ? OR (f.size = ? AND f.id > ?)) ORDER BY f.size ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.size ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else {
      const orderBy = SORT_CLAUSE[sortBy]?.[sortOrder] || SORT_CLAUSE.created_at.desc;
      sql = `${baseSelect} WHERE ${where} ORDER BY ${orderBy} LIMIT ?`;
      queryParams = [...params, queryLimit];
    }

    const items = this.db.prepare(sql).all(...queryParams);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return {
      items,
      hasMore,
      limit,
      offset,
    };
  }

  async searchFiles(query, { type = null, limit = 50, scope = 'all', folderId = null } = {}) {
    const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"*`).join(' ');
    let sql, params;

    if (scope === 'current' && folderId) {
      sql = `
        SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration, f.created_at, f.uploaded_at, fo.path as dir_path
        FROM files f
        JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
        LEFT JOIN folders fo ON f.dir_id = fo.id
        WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?) AND f.dir_id = ?
        LIMIT ?
      `;
      params = [this.webId, ftsQuery, folderId, limit];
    } else {
      sql = `
        SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration, f.created_at, f.uploaded_at, fo.path as dir_path
        FROM files f
        JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
        LEFT JOIN folders fo ON f.dir_id = fo.id
        WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
        LIMIT ?
      `;
      params = [this.webId, ftsQuery, limit];
    }

    let results = this.db.prepare(sql).all(...params);
    if (type && type !== 'all') {
      results = results.filter(f => f.type === type);
    }
    return results;
  }

  async searchFolders(query, { scope = 'all', folderId = null, limit = 50 } = {}) {
    const likeQuery = `%${query}%`;
    let rows;
    if (scope === 'current' && folderId) {
      rows = this.stmts.searchFoldersScoped.all(likeQuery, folderId, folderId, limit);
    } else {
      rows = this.stmts.searchFolders.all(likeQuery, limit);
    }
    return rows.map(f => ({
      id: f.id,
      path: f.path,
      name: f.path.split('/').pop(),
      type: 'folder',
      file_count: f.file_count,
      total_size: f.total_size,
      subfolder_count: f.subfolder_count,
    }));
  }

  async getFileMetadata(fileId) {
    const row = this.db.prepare(`
      SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb,
             f.created_at, f.uploaded_at, f.is_favorite, f.is_locked, f.codec_info,
             f.title, f.artist, f.album, f.genre, f.lyrics, f.lyrics_synced, f.cover_source,
             fo.path as dir_path,
             mv.state as visibility
      FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      LEFT JOIN folders fo ON f.dir_id = fo.id
      WHERE f.id = ?
    `).get(this.webId, fileId);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      path: row.dir_path ? `${row.dir_path}/${row.name}` : row.name,
      type: row.type,
      ext: row.ext,
      size: row.size,
      mtime: row.mtime,
      duration: row.duration || 0,
      hasThumb: !!row.has_thumb,
      createdAt: row.created_at,
      uploadedAt: row.uploaded_at,
      isFavorite: !!row.is_favorite,
      isLocked: !!row.is_locked,
      codecInfo: row.codec_info,
      title: row.title,
      artist: row.artist,
      album: row.album,
      genre: row.genre,
      lyrics: row.lyrics,
      lyricsSynced: row.lyrics_synced,
      coverSource: row.cover_source,
      visibility: row.visibility || 'PRESENT',
    };
  }

  async updateMetadata(fileId, { isFavorite = null, isLocked = null }) {
    const updates = [];
    const params = [];
    if (isFavorite !== null) {
      updates.push('is_favorite = ?');
      params.push(isFavorite ? 1 : 0);
    }
    if (isLocked !== null) {
      updates.push('is_locked = ?');
      params.push(isLocked ? 1 : 0);
    }
    if (updates.length === 0) return { ok: true };
    params.push(fileId);
    this.db.prepare(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return { ok: true };
  }

  async getFolder(folderId) {
    const folder = this.stmts.getFolder.get(folderId);
    if (!folder) return null;
    return {
      id: folder.id,
      path: folder.path,
      parentId: folder.parent_id,
      depth: folder.depth,
      fileCount: folder.file_count,
      totalSize: folder.total_size,
      lastUpdated: folder.last_updated,
      recursiveFileCount: folder.recursive_file_count,
      recursiveTotalSize: folder.recursive_total_size,
    };
  }

  async getFoldersByParent(parentId) {
    return this.stmts.getFoldersByParentDistinct.all(parentId);
  }

  async getPreviewFilesForFolder(folderId, limit = 4) {
    return this.stmts.getPreviewFilesForFolder.all(folderId, limit);
  }

  async getFolderGeneration(folderId) {
    const row = this.stmts.getFolderGeneration.get(folderId);
    return row?.generation || 0;
  }

  async getStats() {
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM files f
      JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE mv.state = "PRESENT"
    `).get(this.webId);
    const byType = this.db.prepare(`
      SELECT f.type, COUNT(*) as count
      FROM files f
      JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE mv.state = "PRESENT"
      GROUP BY f.type
    `).all(this.webId);
    return {
      totalFiles: totalRow?.cnt || 0,
      byType: byType.reduce((acc, row) => { acc[row.type] = row.count; return acc; }, {}),
    };
  }

  async getBatchFiles(ids) {
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    const rows = this.db.prepare(`
      SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration,
             f.created_at, f.uploaded_at, f.is_favorite, f.dir_id, fo.path as dir_path
      FROM files f
      JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      LEFT JOIN folders fo ON f.dir_id = fo.id
      WHERE f.id IN (SELECT json_each.value FROM json_each(?))
    `).all(this.webId, JSON.stringify(uniqueIds));
    const byId = new Map();
    for (const item of rows) {
      byId.set(item.id, {
        id: item.id,
        name: item.name,
        type: item.type,
        ext: item.ext,
        size: item.size,
        mtime: item.mtime,
        created_at: item.created_at,
        has_thumb: item.has_thumb,
        duration: item.duration || 0,
        bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
        uploaded_at: item.uploaded_at || null,
        is_favorite: item.is_favorite || 0,
        dir_path: item.dir_path,
      });
    }
    return {
      items: uniqueIds.filter(id => byId.has(id)).map(id => byId.get(id)),
      missingIds: uniqueIds.filter(id => !byId.has(id)),
    };
  }

  async resolveBatchFilenames(filenames) {
    const unique = [...new Set(filenames)];
    const placeholders = unique.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT id, name FROM files WHERE name IN (${placeholders})`).all(...unique);
    const results = {};
    for (const row of rows) {
      results[row.name] = row.id;
    }
    return results;
  }

  async getSearchSuggestions(query) {
    const q = `%${query.trim()}%`;
    const suggestions = this.db.prepare(`
      SELECT DISTINCT name FROM files
      WHERE name LIKE ? AND id IN (
        SELECT file_id FROM media_visibility WHERE web_id = ? AND state = "PRESENT"
      )
      ORDER BY name
      LIMIT 10
    `).all(q, this.webId);
    return suggestions.map(s => s.name);
  }

  async listFavorites() {
    const rows = this.db.prepare(`
      SELECT f.id, f.name, f.ext, f.size, f.mtime, f.type, f.duration, f.created_at,
             f.has_thumb, f.title, f.artist, f.album
      FROM files f
      JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE mv.state = "PRESENT" AND f.is_favorite = 1 AND f.type = 'audio'
      ORDER BY f.created_at DESC
    `).all(this.webId);
    return rows.map((f) => {
      const name = f.name || '';
      const displayName = name.replace(/\.[^/.]+$/, '') || name;
      return {
        id: f.id,
        file_id: f.id,
        display_name: displayName,
        location: `/file/${f.id}`,
        title: displayName,
        artist: f.artist || '',
        album: f.album || '',
        duration: f.duration || 0,
        track_num: 0,
        exists: true,
        size: f.size || 0,
        mtime: f.mtime || 0,
        created_at: f.created_at || 0,
        type: f.type || 'audio',
        ext: (f.ext || '').replace(/^\./, ''),
        is_favorite: 1,
        has_thumb: f.has_thumb || 0,
      };
    });
  }
}
