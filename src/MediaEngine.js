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
}
