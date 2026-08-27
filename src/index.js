export { MediaEngine } from './MediaEngine.js';
export { MediaScanner } from './MediaScanner.js';
export { EventBus } from './events/EventBus.js';

export { resolveFile } from './resolver/resolveFile.js';

export {
  ensureTables,
  getVisibility,
  setVisibility,
  isVisible,
  getChanges,
} from './visibility/visibility.js';
export {
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

export { assertVisible } from './safety/visibilityGuard.js';
export { assertSafePath } from './safety/pathGuard.js';

export {
  VIDEO_EXTS,
  AUDIO_EXTS,
  IMAGE_EXTS,
  detectType,
} from './scanner/constants.js';

export {
  getFileId,
  resolveFullPath,
  getRelPath,
} from './scanner/fileUtils.js';

export { scanFileSystem, streamFileSystem } from './scanner/walk.js';
export { getDuration, probeVideoMetadata, extractTags, parseTimestamp } from './scanner/probe.js';
export { incrementalSync, enrichDurationsBatch, enrichMetadataBatch } from './scanner/sync.js';

export { createOperationResult, successResult, errorResult } from './operations/result.js';
export { OperationLock } from './operations/lock.js';
export { MediaRepository } from './repository/MediaRepository.js';
export { MockMediaRepository } from './repository/MockMediaRepository.js';
