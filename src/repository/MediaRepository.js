export class MediaRepository {
  // --- File core ---
  getFileById(id) { throw new Error('Not implemented'); }
  getFileWithPath(id) { throw new Error('Not implemented'); }
  upsertFile(file) { throw new Error('Not implemented'); }
  deleteFileById(id) { throw new Error('Not implemented'); }

  // --- Folder core ---
  getFolderById(id) { throw new Error('Not implemented'); }
  getFolderByPath(path) { throw new Error('Not implemented'); }
  ensureFolder(path) { throw new Error('Not implemented'); }

  // --- Folder queries ---
  getFoldersByParent(parentId) { throw new Error('Not implemented'); }
  getPreviewFilesForFolder(folderId, limit) { throw new Error('Not implemented'); }
  getFolderGeneration(folderId) { throw new Error('Not implemented'); }
  searchFolders(query, limit) { throw new Error('Not implemented'); }
  searchFoldersScoped(query, folderId, limit) { throw new Error('Not implemented'); }

  // --- Visibility (webId-scoped soft delete) ---
  ensureVisibilityTables() { throw new Error('Not implemented'); }
  getVisibilityState(fileId, webId) { throw new Error('Not implemented'); }
  setVisibilityState(fileId, webId, state, payload) { throw new Error('Not implemented'); }
  isVisible(fileId, webId) { throw new Error('Not implemented'); }
  getChanges(webId, sinceTimestamp) { throw new Error('Not implemented'); }

  // --- Changesets (cross-env promotion) ---
  ensureChangesetTables() { throw new Error('Not implemented'); }
  createChangeset(webId, name, description) { throw new Error('Not implemented'); }
  finalizeChangeset(changesetId) { throw new Error('Not implemented'); }
  addChangeToChangeset(changesetId, changeId) { throw new Error('Not implemented'); }
  getChangeset(changesetId) { throw new Error('Not implemented'); }
  listChangesets(webId, stateFilter) { throw new Error('Not implemented'); }
  detectConflicts(changesetId, targetWebId, targetRepository) { throw new Error('Not implemented'); }
  applyChangeset(changesetId, targetWebId, targetRepository) { throw new Error('Not implemented'); }

  // --- File queries (visibility-joined) ---
  listFiles({ webId, folderId, type, favoriteOnly, sortBy, sortOrder, limit, cursor, prevCursor }) { throw new Error('Not implemented'); }
  searchFiles({ webId, query, type, folderId, scope, limit }) { throw new Error('Not implemented'); }
  getFileMetadata(fileId, webId) { throw new Error('Not implemented'); }
  updateMetadata(fileId, changes) { throw new Error('Not implemented'); }
  getStats(webId) { throw new Error('Not implemented'); }
  getBatchFiles(ids, webId) { throw new Error('Not implemented'); }
  resolveBatchFilenames(filenames) { throw new Error('Not implemented'); }
  getSearchSuggestions(query, webId) { throw new Error('Not implemented'); }
  listFavorites(webId) { throw new Error('Not implemented'); }

  // --- Aggregation (for scanner, monitor) ---
  countByType() { throw new Error('Not implemented'); }
  findByDirPattern(folderName, subfolderPattern, limit, offset) { throw new Error('Not implemented'); }
  updateFolderSize(dirId, delta, now) { throw new Error('Not implemented'); }
  incrementFolderSize(dirId, size, now) { throw new Error('Not implemented'); }
  decrementFolderSize(dirId, size, now) { throw new Error('Not implemented'); }
  updateCreatedAt(id, createdAt) { throw new Error('Not implemented'); }
  deleteFilesByFolder(dirId) { throw new Error('Not implemented'); }
  deleteFolder(id) { throw new Error('Not implemented'); }
  getAllFolders() { throw new Error('Not implemented'); }
  reconcileFolders() { throw new Error('Not implemented'); }
  updateAllRecursiveCounts() { throw new Error('Not implemented'); }
  getFilesNeedingDuration(limit) { throw new Error('Not implemented'); }
  updateDuration(id, duration) { throw new Error('Not implemented'); }
  updateCodecInfo(id, codecInfo, isStreamCompatible) { throw new Error('Not implemented'); }
  updatePlaylistTrackDurationByPath(duration, fullPath) { throw new Error('Not implemented'); }
  refreshPlaylistTrackDurations() { throw new Error('Not implemented'); }
  recomputeAllPlaylistTotals() { throw new Error('Not implemented'); }
  getFilesNeedingMetadata(limit) { throw new Error('Not implemented'); }
  updateCreatedAtEmbedded(id, createdAt, source) { throw new Error('Not implemented'); }

  // --- Raw access for legacy/transition (temporary) ---
  query(sql, params) { throw new Error('Not implemented'); }
  queryOne(sql, params) { throw new Error('Not implemented'); }
  run(sql, params) { throw new Error('Not implemented'); }
  transaction(fn) { throw new Error('Not implemented'); }
}
