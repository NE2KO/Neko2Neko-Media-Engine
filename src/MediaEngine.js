import { resolveFile } from './resolver/resolveFile.js';
import { EventBus } from './events/EventBus.js';
import { OperationLock } from './operations/lock.js';
import { errorResult } from './operations/result.js';
import { validatePromotionPath, detectConflicts, ENVIRONMENT_ORDER } from './visibility/changeset.js';

export class MediaEngine {
  constructor({ webId, repository, mediaRoots }) {
    this.webId = webId || null;
    this.repository = repository;
    this.mediaRoots = Array.isArray(mediaRoots) ? mediaRoots : [mediaRoots];
    this.events = new EventBus();
    this._locks = new OperationLock();
    if (webId) {
      this.repository.ensureVisibilityTables();
      this.repository.ensureChangesetTables();
    }
  }

  async resolve(fileId) {
    const file = await resolveFile(fileId, this.repository, this.mediaRoots);
    if (!file) return null;
    if (!this.repository.isVisible(fileId, this.webId)) {
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
    return this.repository.isVisible(fileId, this.webId);
  }

  delete(fileId) {
    const result = this.repository.setVisibilityState(fileId, this.webId, 'DELETED');
    if (result.already === 'DELETED') {
      return { changeId: null, fileId, webId: this.webId, operation: 'DELETE', state: 'DELETED', already: true };
    }
    return { changeId: result.changeId, fileId, webId: this.webId, operation: 'DELETE', state: 'DELETED', previous: result.previous };
  }

  restore(fileId) {
    const result = this.repository.setVisibilityState(fileId, this.webId, 'PRESENT');
    if (result.already === 'PRESENT') {
      return { changeId: null, fileId, webId: this.webId, operation: 'RESTORE', state: 'PRESENT', already: true };
    }
    return { changeId: result.changeId, fileId, webId: this.webId, operation: 'RESTORE', state: 'PRESENT', previous: result.previous };
  }

  async trash(fileId, options = {}) {
    const release = await this._locks.acquire(fileId, 'trash');
    try {
      const file = this.repository.getFileById(fileId);
      if (!file) return errorResult('trash', fileId, 'FILE_NOT_FOUND', 'File not found');
      return errorResult('trash', fileId, 'NOT_IMPLEMENTED', 'trash() will be implemented in Phase 5');
    } finally {
      release();
    }
  }

  async purge(fileId, options = {}) {
    const release = await this._locks.acquire(fileId, 'purge');
    try {
      const file = this.repository.getFileById(fileId);
      if (!file) return errorResult('purge', fileId, 'FILE_NOT_FOUND', 'File not found');
      return errorResult('purge', fileId, 'NOT_IMPLEMENTED', 'purge() will be implemented in Phase 5');
    } finally {
      release();
    }
  }

  async move(fileId, destination, options = {}) {
    const release = await this._locks.acquire(fileId, 'move');
    try {
      const file = this.repository.getFileById(fileId);
      if (!file) return errorResult('move', fileId, 'FILE_NOT_FOUND', 'File not found');
      return errorResult('move', fileId, 'NOT_IMPLEMENTED', 'move() will be implemented in Phase 7');
    } finally {
      release();
    }
  }

  async rename(fileId, newName, options = {}) {
    const release = await this._locks.acquire(fileId, 'rename');
    try {
      const file = this.repository.getFileById(fileId);
      if (!file) return errorResult('rename', fileId, 'FILE_NOT_FOUND', 'File not found');
      return errorResult('rename', fileId, 'NOT_IMPLEMENTED', 'rename() will be implemented in Phase 7');
    } finally {
      release();
    }
  }

  // --- Visibility (delegated to repository) ---

  getChanges(sinceTimestamp = 0) {
    return this.repository.getChanges(this.webId, sinceTimestamp);
  }

  // --- Changesets (delegated to repository) ---

  createChangeset(name = '', description = '') {
    return this.repository.createChangeset(this.webId, name, description);
  }

  finalizeChangeset(changeset_id) {
    return this.repository.finalizeChangeset(changeset_id);
  }

  addToChangeset(changeset_id, change_id) {
    return this.repository.addChangeToChangeset(changeset_id, change_id);
  }

  inspectChangeset(changeset_id) {
    return this.repository.getChangeset(changeset_id);
  }

  listChangesets(stateFilter = null) {
    return this.repository.listChangesets(this.webId, stateFilter);
  }

  validatePromotion(targetWebId) {
    return validatePromotionPath(this.webId, targetWebId);
  }

  ensureChangesetTables(db) {
    return this.repository.ensureChangesetTables();
  }

  preflightApply(changeset_id, targetWebId, targetRepository = null) {
    validatePromotionPath(this.webId, targetWebId);
    const cs = this.repository.getChangeset(changeset_id);
    if (!cs) throw new Error(`Changeset ${changeset_id} not found`);
    if (cs.state !== 'FINALIZED') throw new Error(`Changeset must be FINALIZED, current: ${cs.state}`);
    const conflicts = this.repository.detectConflicts(changeset_id, targetWebId, targetRepository || this.repository);
    return {
      changeset: cs,
      promotionPath: { source: this.webId, target: targetWebId },
      conflicts,
      safeToApply: conflicts.length === 0,
    };
  }

  applyChangeset(changeset_id, targetWebId, targetRepository = null) {
    return this.repository.applyChangeset(changeset_id, targetWebId, targetRepository || this.repository);
  }

  // --- File queries (delegated to repository) ---

  async listFiles(options) {
    return this.repository.listFiles({ ...options, webId: this.webId });
  }

  async searchFiles(query, options = {}) {
    return this.repository.searchFiles({ ...options, webId: this.webId, query });
  }

  async searchFolders(query, options = {}) {
    const { scope = 'all', folderId = null, limit = 50 } = options;
    let rows;
    if (scope === 'current' && folderId) {
      rows = this.repository.searchFoldersScoped(query, folderId, limit);
    } else {
      rows = this.repository.searchFolders(query, limit);
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
    return this.repository.getFileMetadata(fileId, this.webId);
  }

  async updateMetadata(fileId, updates) {
    return this.repository.updateMetadata(fileId, updates);
  }

  async getFolder(folderId) {
    return this.repository.getFolderById(folderId);
  }

  async getFoldersByParent(parentId) {
    return this.repository.getFoldersByParent(parentId);
  }

  async getPreviewFilesForFolder(folderId, limit = 4) {
    return this.repository.getPreviewFilesForFolder(folderId, limit);
  }

  async getFolderGeneration(folderId) {
    return this.repository.getFolderGeneration(folderId);
  }

  async getStats() {
    return this.repository.getStats(this.webId);
  }

  async getBatchFiles(ids) {
    return this.repository.getBatchFiles(ids, this.webId);
  }

  async resolveBatchFilenames(filenames) {
    return this.repository.resolveBatchFilenames(filenames);
  }

  async getSearchSuggestions(query) {
    return this.repository.getSearchSuggestions(query, this.webId);
  }

  async listFavorites() {
    return this.repository.listFavorites(this.webId);
  }
}
