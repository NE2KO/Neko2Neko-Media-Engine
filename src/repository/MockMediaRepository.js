import { MediaRepository } from './MediaRepository.js';

export class MockMediaRepository extends MediaRepository {
  constructor() {
    super();
    this._files = new Map();
    this._folders = new Map();
    this._visibility = new Map();
    this._changes = [];
    this._changesets = new Map();
    this._nextId = 1;
  }

  // --- File core ---

  getFileById(id) {
    return this._files.get(id) || null;
  }

  getFileWithPath(id) {
    const file = this._files.get(id);
    if (!file) return null;
    const folder = this._folders.get(file.dir_id);
    return { ...file, dir_path: folder?.path || null };
  }

  upsertFile(file) {
    const id = file.id || `mock-${this._nextId++}`;
    this._files.set(id, { ...file, id });
  }

  deleteFileById(id) {
    this._files.delete(id);
  }

  // --- Folder core ---

  getFolderById(id) {
    const folder = this._folders.get(id);
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

  getFolderByPath(path) {
    for (const folder of this._folders.values()) {
      if (folder.path === path) return folder;
    }
    return null;
  }

  ensureFolder(path) {
    if (!path) path = '';
    const existing = this.getFolderByPath(path);
    if (existing) return existing.id;

    const lastSlash = path.lastIndexOf('/');
    const parentPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';
    const parentId = parentPath ? this.ensureFolder(parentPath) : null;
    const depth = parentId ? (this._folders.get(parentId)?.depth || 0) + 1 : 0;
    const id = `folder-${this._nextId++}`;

    this._folders.set(id, {
      id,
      path,
      parent_id: parentId,
      depth,
      file_count: 0,
      total_size: 0,
      last_scanned: Date.now(),
      last_updated: Date.now(),
      recursive_file_count: 0,
      recursive_total_size: 0,
    });

    return id;
  }

  // --- Folder queries ---

  getFoldersByParent(parentId) {
    const results = [];
    for (const folder of this._folders.values()) {
      if (folder.parent_id === parentId) {
        results.push({
          id: folder.id,
          path: folder.path,
          file_count: folder.file_count,
          total_size: folder.total_size,
          subfolder_count: 0,
        });
      }
    }
    return results;
  }

  getPreviewFilesForFolder(folderId, limit = 4) {
    const results = [];
    for (const file of this._files.values()) {
      if (file.dir_id === folderId) {
        results.push({ id: file.id, name: file.name, type: file.type, ext: file.ext, has_thumb: file.has_thumb });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  getFolderGeneration(folderId) {
    const folder = this._folders.get(folderId);
    return folder?.generation || 0;
  }

  searchFolders(query, limit) {
    const q = query.toLowerCase();
    const results = [];
    for (const folder of this._folders.values()) {
      if (folder.path.toLowerCase().includes(q)) {
        results.push({ id: folder.id, path: folder.path, file_count: folder.file_count, total_size: folder.total_size, subfolder_count: 0 });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  searchFoldersScoped(query, folderId, limit) {
    const q = query.toLowerCase();
    const results = [];
    for (const folder of this._folders.values()) {
      if (folder.path.toLowerCase().includes(q) && folder.parent_id === folderId) {
        results.push({ id: folder.id, path: folder.path, file_count: folder.file_count, total_size: folder.total_size, subfolder_count: 0 });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // --- Visibility ---

  ensureVisibilityTables() {}

  getVisibilityState(fileId, webId) {
    return this._visibility.get(`${fileId}:${webId}`) || 'PRESENT';
  }

  setVisibilityState(fileId, webId, state, payload = null) {
    const key = `${fileId}:${webId}`;
    const previous = this._visibility.get(key) || 'PRESENT';
    if (previous === state) return { changeId: null, already: state };
    this._visibility.set(key, state);
    const changeId = `change-${this._nextId++}`;
    this._changes.push({ changeId, webId, fileId, operation: state === 'DELETED' ? 'DELETE' : 'RESTORE', previous_state: previous, new_state: state, payload, created_at: Date.now() });
    return { changeId, previous, next: state };
  }

  isVisible(fileId, webId) {
    return this.getVisibilityState(fileId, webId) === 'PRESENT';
  }

  getChanges(webId, sinceTimestamp = 0) {
    return this._changes.filter(c => c.webId === webId && c.created_at > sinceTimestamp);
  }

  // --- Changesets ---

  ensureChangesetTables() {}

  createChangeset(webId, name, description) {
    const changeset_id = `cs-${this._nextId++}`;
    const now = Date.now();
    this._changesets.set(changeset_id, { changeset_id, web_id: webId, name: name || null, description: description || null, state: 'DRAFT', created_at: now, finalized_at: null, applied_at: null, items: [] });
    return { changeset_id, webId, name, description, state: 'DRAFT', created_at: now };
  }

  finalizeChangeset(changesetId) {
    const cs = this._changesets.get(changesetId);
    if (!cs) throw new Error(`Changeset ${changesetId} not found`);
    if (cs.state !== 'DRAFT') throw new Error(`Cannot finalize changeset in state ${cs.state}`);
    const now = Date.now();
    cs.state = 'FINALIZED';
    cs.finalized_at = now;
    return { changeset_id: changesetId, state: 'FINALIZED', finalized_at: now };
  }

  addChangeToChangeset(changesetId, changeId) {
    const cs = this._changesets.get(changesetId);
    if (!cs) throw new Error(`Changeset ${changesetId} not found`);
    if (cs.state !== 'DRAFT') throw new Error(`Cannot add to changeset in state ${cs.state}`);
    if (!cs.items.includes(changeId)) cs.items.push(changeId);
    return { changeset_id: changesetId, change_id: changeId, added: true };
  }

  getChangeset(changesetId) {
    const cs = this._changesets.get(changesetId);
    if (!cs) return null;
    return { ...cs, items: this._changes.filter(c => cs.items.includes(c.changeId)) };
  }

  listChangesets(webId, stateFilter = null) {
    const results = [];
    for (const cs of this._changesets.values()) {
      if (cs.web_id === webId && (!stateFilter || cs.state === stateFilter)) {
        results.push(cs);
      }
    }
    return results;
  }

  detectConflicts(changesetId, targetWebId, targetRepository) {
    return [];
  }

  applyChangeset(changesetId, targetWebId, targetRepository) {
    throw new Error('MockMediaRepository.applyChangeset not implemented');
  }

  // --- File queries ---

  listFiles({ webId, folderId, type, favoriteOnly, sortBy = 'created_at', sortOrder = 'desc', limit = 100, offset = 0 }) {
    let items = [];
    for (const file of this._files.values()) {
      if (!this.isVisible(file.id, webId)) continue;
      if (folderId && file.dir_id !== folderId) continue;
      if (type && file.type !== type) continue;
      if (favoriteOnly && !file.is_favorite) continue;
      items.push(file);
    }
    items.sort((a, b) => {
      const va = a[sortBy] || 0;
      const vb = b[sortBy] || 0;
      return sortOrder === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
    });
    const hasMore = items.length > limit;
    if (hasMore) items = items.slice(0, limit);
    return { items, hasMore, limit, offset };
  }

  searchFiles({ webId, query, type = null, limit = 50 }) {
    const q = query.toLowerCase();
    const results = [];
    for (const file of this._files.values()) {
      if (!this.isVisible(file.id, webId)) continue;
      if (file.name.toLowerCase().includes(q)) {
        if (!type || type === 'all' || file.type === type) {
          results.push(file);
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }

  getFileMetadata(fileId, webId) {
    const file = this._files.get(fileId);
    if (!file) return null;
    const folder = this._folders.get(file.dir_id);
    return {
      id: file.id,
      name: file.name,
      path: folder ? `${folder.path}/${file.name}` : file.name,
      type: file.type,
      ext: file.ext,
      size: file.size,
      mtime: file.mtime,
      duration: file.duration || 0,
      hasThumb: !!file.has_thumb,
      createdAt: file.created_at,
      uploadedAt: file.uploaded_at,
      isFavorite: !!file.is_favorite,
      isLocked: !!file.is_locked,
      visibility: this.getVisibilityState(fileId, webId),
    };
  }

  updateMetadata(fileId, { isFavorite = null, isLocked = null }) {
    const file = this._files.get(fileId);
    if (!file) return { ok: false };
    if (isFavorite !== null) file.is_favorite = isFavorite ? 1 : 0;
    if (isLocked !== null) file.is_locked = isLocked ? 1 : 0;
    return { ok: true };
  }

  getStats(webId) {
    let totalFiles = 0;
    const byType = {};
    for (const file of this._files.values()) {
      if (this.isVisible(file.id, webId)) {
        totalFiles++;
        byType[file.type] = (byType[file.type] || 0) + 1;
      }
    }
    return { totalFiles, byType };
  }

  getBatchFiles(ids, webId) {
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    const items = [];
    const missingIds = [];
    for (const id of uniqueIds) {
      const file = this._files.get(id);
      if (file && this.isVisible(id, webId)) {
        items.push(file);
      } else {
        missingIds.push(id);
      }
    }
    return { items, missingIds };
  }

  resolveBatchFilenames(filenames) {
    const results = {};
    const unique = [...new Set(filenames)];
    for (const name of unique) {
      for (const file of this._files.values()) {
        if (file.name === name) {
          results[name] = file.id;
          break;
        }
      }
    }
    return results;
  }

  getSearchSuggestions(query, webId) {
    const q = `%${query.trim()}%`;
    const suggestions = [];
    for (const file of this._files.values()) {
      if (this.isVisible(file.id, webId) && file.name.includes(query)) {
        suggestions.push(file.name);
        if (suggestions.length >= 10) break;
      }
    }
    return suggestions;
  }

  listFavorites(webId) {
    const results = [];
    for (const file of this._files.values()) {
      if (this.isVisible(file.id, webId) && file.is_favorite && file.type === 'audio') {
        const name = file.name || '';
        const displayName = name.replace(/\.[^/.]+$/, '') || name;
        results.push({
          id: file.id,
          file_id: file.id,
          display_name: displayName,
          title: displayName,
          artist: file.artist || '',
          album: file.album || '',
          duration: file.duration || 0,
          type: 'audio',
          ext: (file.ext || '').replace(/^\./, ''),
          is_favorite: 1,
          has_thumb: file.has_thumb || 0,
        });
      }
    }
    return results;
  }

  // --- Aggregation ---

  countByType() {
    const counts = {};
    for (const file of this._files.values()) {
      counts[file.type] = (counts[file.type] || 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => ({ type, count }));
  }

  findByDirPattern(folderName, subfolderPattern, limit, offset) {
    return [];
  }

  updateFolderSize() {}
  incrementFolderSize() {}
  decrementFolderSize() {}
  updateCreatedAt() {}
  deleteFilesByFolder(dirId) {
    for (const [id, file] of this._files) {
      if (file.dir_id === dirId) this._files.delete(id);
    }
  }
  deleteFolder(id) { this._folders.delete(id); }
  getAllFolders() { return [...this._folders.values()].map(f => ({ id: f.id, path: f.path })); }
  reconcileFolders() {}
  updateAllRecursiveCounts() { return 0; }
  getFilesNeedingDuration() { return []; }
  updateDuration() {}
  updateCodecInfo() {}
  updatePlaylistTrackDurationByPath() {}
  refreshPlaylistTrackDurations() {}
  recomputeAllPlaylistTotals() {}
  getFilesNeedingMetadata() { return []; }
  updateCreatedAtEmbedded() {}

  // --- Raw access (no-op for mock) ---
  query() { return []; }
  queryOne() { return null; }
  run() { return { changes: 0 }; }
  transaction(fn) { return fn(); }
}
