import { resolveFile } from './resolver/resolveFile.js';
import { resolveFileForEngine } from './resolver/resolveFile.js';
import { EventBus } from './events/EventBus.js';
import { OperationLock } from './operations/lock.js';
import { errorResult } from './operations/result.js';
import { validatePromotionPath, detectConflicts, ENVIRONMENT_ORDER } from './visibility/changeset.js';
import { scanFileSystem } from './scanner/walk.js';
import { AUDIO_EXTS, VIDEO_EXTS, IMAGE_EXTS } from './scanner/constants.js';

const MIME_MAP = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

const STRIPPED_FIELDS = new Set(['fullPath']);

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

  _guessMimeType(ext) {
    return MIME_MAP[ext?.toLowerCase()] || 'application/octet-stream';
  }

  async resolve(fileId) {
    const file = await resolveFile(fileId, this.repository, this.mediaRoots);
    if (!file) return null;
    if (!this.repository.isVisible(fileId, this.webId)) {
      const stripped = { ...file };
      for (const key of STRIPPED_FIELDS) {
        delete stripped[key];
      }
      return { ...stripped, blocked: true, reason: 'deleted' };
    }
    const stripped = { ...file };
    for (const key of STRIPPED_FIELDS) {
      delete stripped[key];
    }
    return stripped;
  }

  async openMedia(fileId) {
    const file = await this.resolve(fileId);
    if (!file) throw new Error('FILE_NOT_FOUND');
    if (file.blocked) throw new Error('FILE_NOT_AVAILABLE');
    if (!file.exists) throw new Error('FILE_MISSING');

    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');

    const { createReadStream } = await import('node:fs');
    const stream = createReadStream(internal.fullPath);

    return {
      stream,
      size: file.size,
      mimeType: this._guessMimeType(file.ext),
      etag: file.id,
      lastModified: file.mtime,
    };
  }

  async openThumbnail(fileId) {
    const file = await this.resolve(fileId);
    if (!file) throw new Error('FILE_NOT_FOUND');
    if (file.blocked) throw new Error('FILE_NOT_AVAILABLE');
    if (!file.exists) throw new Error('FILE_MISSING');

    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');

    const { createReadStream } = await import('node:fs');
    const stream = createReadStream(internal.thumbCachePath || internal.fullPath);

    return {
      stream,
      mimeType: 'image/jpeg',
    };
  }

  async getServeTarget(fileId) {
    const file = await this.resolve(fileId);
    if (!file) return { error: 'not_found' };
    if (file.blocked) return { error: 'not_available' };
    if (file.exists === false) return { error: 'file_missing' };

    const resource = await this.openMedia(fileId);

    return {
      stream: resource.stream,
      size: resource.size,
      mimeType: resource.mimeType,
      etag: resource.etag,
      lastModified: resource.lastModified,
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

  async ingestUpload(tmpPath, relPath, metadata = {}) {
    const { mkdirSync, renameSync, statSync } = await import('node:fs');
    const { join, dirname, extname } = await import('node:path');

    const absPath = join(this.mediaRoots[0], relPath);

    mkdirSync(dirname(absPath), { recursive: true });

    renameSync(tmpPath, absPath);

    let size = 0;
    let mtime = Date.now();
    try {
      const st = statSync(absPath);
      size = st.size;
      mtime = Math.floor(st.mtimeMs);
    } catch {}

    const ext = extname(relPath).toLowerCase();
    const fileId = await import('./scanner/fileUtils.js').then(m => m.getFileId(relPath));

    return {
      fileId,
      size,
      mtime,
      path: absPath,
      relPath,
    };
  }

  async deleteMediaByPath(relPath) {
    const { unlink } = await import('node:fs/promises');
    const absPath = join(this.mediaRoots[0], relPath);

    try {
      await unlink(absPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    return { deleted: true };
  }

  async scanDirectoryForAudio(dirPath) {
    const results = [];
    const audioExts = new Set(['.mp3', '.flac', '.opus', '.wav', '.ogg', '.aac', '.m4a', '.wma', '.webm']);

    const entries = await scanFileSystem(dirPath, '', { recursive: true });

    for (const entry of entries) {
      const ext = entry.ext?.toLowerCase() || '';
      if (!audioExts.has(ext)) continue;

      const { getFileId } = await import('./scanner/fileUtils.js');
      results.push({
        id: entry.id || getFileId(entry.relPath),
        name: entry.name,
        path: entry.relPath,
        type: entry.type,
        ext: entry.ext,
        size: entry.size,
        mtime: entry.mtime,
      });
    }

    return results;
  }

  async deleteMedia(fileId) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { unlink } = await import('node:fs/promises');
    await unlink(internal.fullPath);
    return { deleted: true, path: internal.fullPath };
  }

  async writeMediaMetadata(fileId, updates) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');

    const { writeMetadata } = await import('./scanner/metadataWriter.js');
    await writeMetadata(internal.fullPath, updates);
    return { ok: true };
  }

  async probeMedia(fileId) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');

    const { probeVideoMetadata } = await import('./scanner/probe.js');
    return await probeVideoMetadata(internal.fullPath);
  }

  async generateThumbnail(fileId, outputPath) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');

    const {
      hasEmbeddedCover,
      extractEmbeddedThumbnail,
      extractFrameThumbnail,
      generateImageThumbnail,
      generateAudioPlaceholder,
    } = await import('./scanner/thumbnailUtils.js');

    if (internal.type === 'video') {
      if (hasEmbeddedCover(internal.fullPath)) {
        return await extractEmbeddedThumbnail(internal.fullPath, outputPath);
      }
      return await extractFrameThumbnail(internal.fullPath, outputPath);
    }
    if (internal.type === 'audio') {
      return await generateAudioPlaceholder(outputPath, internal.name);
    }
    if (internal.type === 'image') {
      return await generateImageThumbnail(internal.fullPath, outputPath);
    }
    return null;
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
    if (cs.state !== 'FINALIZED') {
      throw new Error(`Changeset must be FINALIZED, current: ${cs.state}`);
    }
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

  async transcodeMedia(fileId, options = {}) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { runFfmpeg } = await import('./scanner/transcode.js');
    return await runFfmpeg(internal.fullPath, options);
  }

  async remuxMedia(fileId, outputPath) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { runFfmpeg } = await import('./scanner/transcode.js');
    return await runFfmpeg(internal.fullPath, { outputPath, remux: true });
  }

  async faststartMedia(fileId, outputPath) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { runFfmpeg } = await import('./scanner/transcode.js');
    return await runFfmpeg(internal.fullPath, { outputPath, faststart: true });
  }

  async generateHLS(fileId, options = {}) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const workDir = options.workDir || join(tmpdir(), `media-engine-hls-${Date.now()}`);

    const { generateHLSSegments } = await import('./scanner/hls.js');
    return await generateHLSSegments(internal.fullPath, workDir, options);
  }

  async readMediaMetadata(fileId) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { readMetadata } = await import('./scanner/metadataWriter.js');
    return await readMetadata(internal.fullPath);
  }

  async embedCover(fileId, imageBuffer, mimeType) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { embedCover } = await import('./scanner/metadataWriter.js');
    return await embedCover(internal.fullPath, imageBuffer, mimeType);
  }

  async writeLyrics(fileId, lyrics) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { writeLyrics } = await import('./scanner/metadataWriter.js');
    return await writeLyrics(internal.fullPath, lyrics);
  }

  async readCover(fileId) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { readCover } = await import('./scanner/metadataWriter.js');
    return await readCover(internal.fullPath);
  }

  async resolveFaststartState(fileId) {
    const internal = await resolveFileForEngine(fileId, this.repository, this.mediaRoots);
    if (!internal) throw new Error('FILE_NOT_FOUND');
    if (!internal.exists) throw new Error('FILE_MISSING');

    const { probeVideoMetadata } = await import('./scanner/probe.js');
    const meta = await probeVideoMetadata(internal.fullPath);
    if (!meta) {
      return { compatible: false, reason: 'probe_failed' };
    }

    const ext = (internal.ext || '').toLowerCase();
    const isMuxableBrowserContainer = ['.mp4', '.m4v', '.mov'].includes(ext);
    const isH264 = meta.videoCodec === 'h264';
    const isHevc = meta.videoCodec === 'hevc';

    if (isMuxableBrowserContainer && (isH264 || isHevc)) {
      const needsFaststart = !meta.is_stream_compatible;
      return {
        compatible: true,
        needsFaststart,
        videoCodec: meta.videoCodec,
        audioCodec: meta.audioCodec,
        format: meta.format,
      };
    }

    return {
      compatible: false,
      reason: 'not_muxable_browser_container',
      videoCodec: meta.videoCodec,
      audioCodec: meta.audioCodec,
      format: meta.format,
    };
  }
}
