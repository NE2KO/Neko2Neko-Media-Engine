# @homelab/media-engine

> Shared media gateway, path resolver, visibility guard, and filesystem safety boundary for the Homelab Media Server.

[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](https://nodejs.org)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![Private](https://img.shields.io/badge/private-true-lightgrey)](#)

Version **0.1.0** · ESM-only · `file:../../media-engine` (no npm publish yet)

---

## Table of Contents

- [About](#about)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [MediaEngine](#mediaengine)
  - [MediaScanner](#mediascanner)
  - [MediaRepository](#mediarepository)
  - [MockMediaRepository](#mockmediarepository)
  - [Scanner Utilities](#scanner-utilities)
  - [Safety Guards](#safety-guards)
  - [Visibility & Changesets](#visibility--changesets)
  - [Operations](#operations)
  - [Events](#events)
- [File → Web Path](#file--web-path)
- [Visibility Semantics](#visibility-semantics)
- [Filesystem Safety](#filesystem-safety)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Related](#related)

---

## About

`@homelab/media-engine` is the **single domain boundary** for all media resources in the Homelab stack. The web layer (`homelab-media-server`) never touches the filesystem or SQLite directly for media — it asks the engine.

**What the engine owns:**
- Incremental filesystem discovery (`MediaScanner`)
- Safe path resolution (`resolveFile` + `assertSafePath` / `assertVisible`)
- Visibility (soft-delete per `webId`, `media_visibility` table)
- Cross-env changeset promotion (`beta → pre → release`)
- File queries (listing, search, metadata, batch, stats) with visibility
- Operation primitives (`OperationLock`, `OperationResult`, future `trash`/`purge`/`move`/`rename`)

**What stays in the backend:**
- HTTP (`res.sendFile`, `Range`, `Cache-Control`), SSE, multipart upload
- FFmpeg (thumbnails, HLS, transcode), YouTube/video cache, playlists, send queue, ADB, Telegram, WhatsApp, AI

> Design decisions and the 13-phase production plan live in [`plan.md`](plan.md).

---

## Architecture

```text
HTTP Route
  ↓  engine.resolve() / getServeTarget() / listFiles() / searchFiles()
MediaEngine  ── visibility, sorting, pagination, safety
  ↓  repository.listFiles() / getFileWithPath() / isVisible()
MediaRepository  (interface — dependency injection)
  ↓
SqliteMediaRepository  (backend)  or  MockMediaRepository  (tests)
  ↓  better-sqlite3 / in-memory
SQLite  ── files, folders, files_fts (FTS5), media_visibility, media_changesets
  ↓
Filesystem  ── MEDIA_ROOT (e.g. /home/CATIAA/homelab, homelab/Music → /home/CATIAA/Music via symlink)
```

**No second scanner, no second resolver.** `fileResolver.js`, `fileScanner.js`, `scannerWorker.js`, `scannerClient.js`, `watcher.js` are deleted — `MediaScanner` is the only scanner.

---

## Installation

`homelab-media-server` already declares it:

```json
// backend/package.json
"@homelab/media-engine": "file:../../media-engine"
```

After pulling or editing `media-engine`, re-sync the copy in `backend/node_modules`:

```bash
cd homelab-media-server/backend && npm install --silent
```

The package is `private: true` and ESM-only (`"type": "module"`).

Sub-path exports for the repository implementation:

```js
import { getVisibility, setVisibility } from '@homelab/media-engine/visibility';
import { createChangeset } from '@homelab/media-engine/changeset';
```

---

## Quick Start

```js
import { MediaEngine, MediaScanner } from '@homelab/media-engine';
import { SqliteMediaRepository } from './repository/sqliteMediaRepository.js';
import db, { stmts } from './db.js';

const MEDIA_ROOT = (process.env.MEDIA_ROOT || '/home/CATIAA/homelab').split(':');
const repository = new SqliteMediaRepository(db, stmts);

// Single engine for the whole process (webId = visibility scope)
const mediaEngine = new MediaEngine({ repository, mediaRoots: MEDIA_ROOT, webId: 'default' });
globalThis.mediaEngine = mediaEngine;

// Scanner — read/discovery only
const mediaScanner = new MediaScanner({
  repository,
  mediaRoots: MEDIA_ROOT,
  callbacks: {
    onNewFile: (fullPath, type) => queueThumbnail(fullPath, type),
    broadcastStats: () => sseBroadcast(),
  },
  config: { workers: 4 },
});
globalThis.mediaScanner = mediaScanner;
mediaScanner.startWatcher();
await mediaScanner.scan();
```

**Route example (file serving):**

```js
// backend/src/routes/file.js
router.get('/:id', async (req, res) => {
  const target = await globalThis.mediaEngine.getServeTarget(req.params.id);
  if (target.error) return res.status(404).json({ error: 'File not found' });
  res.sendFile(target.path, { headers: target.headers });
});
```

---

## API Reference

### MediaEngine

`new MediaEngine({ webId, repository, mediaRoots })`

| Method | Signature | Description |
|--------|-----------|-------------|
| `resolve` | `async resolve(fileId) → file \| {blocked:true} \| null` | DB lookup + `realpath` + `assertSafePath` + `isVisible` |
| `getServeTarget` | `async getServeTarget(fileId) → {path, headers} \| {error}` | For `res.sendFile`; handles `not_found` / `not_available` (visibility) / `file_missing` |
| `stat` | `async stat(fileId) → {size, mtime, exists} \| null` | Lightweight existence check |
| `isVisible` | `isVisible(fileId) → boolean` | Visibility for `webId` |
| `delete` / `restore` | `delete(fileId)`, `restore(fileId)` | Soft-delete via `media_visibility` (no FS) |
| `trash` / `purge` / `move` / `rename` | `async *` | Stubs (`NOT_IMPLEMENTED`) — Phase 5/7 |
| `listFiles` | `async listFiles({folderId, type, favoriteOnly, sortBy, sortOrder, limit, cursor, prevCursor})` | Visibility-joined pagination |
| `searchFiles` | `async searchFiles(query, {type, folderId, scope, limit})` | FTS5 (`files_fts`) + visibility |
| `searchFolders` | `async searchFolders(query, {scope, folderId, limit})` | `LIKE` on `folders.path` |
| `getFileMetadata` | `async getFileMetadata(fileId)` | Full row + `dir_path` + visibility |
| `updateMetadata` | `async updateMetadata(fileId, {isFavorite, isLocked, title, artist, album, genre, cover_source, lyrics, lyrics_synced, lyrics_romaji, youtube_id, video_offset})` | Whitelist-only, rejects unknown fields |
| `getFolder` | `async getFolder(folderId)` | Normalized `{id, path, parentId, depth, fileCount, totalSize, ...}` |
| `getFoldersByParent` | `async getFoldersByParent(parentId)` | Direct subfolders |
| `getPreviewFilesForFolder` | `async getPreviewFilesForFolder(folderId, limit=4)` | For folder previews |
| `getFolderGeneration` | `async getFolderGeneration(folderId)` | For binary index `ETag` |
| `getStats` | `async getStats()` | `{totalFiles, byType}` visibility-aware |
| `getBatchFiles` | `async getBatchFiles(ids)` | `{items, missingIds}` via `json_each` |
| `resolveBatchFilenames` | `async resolveBatchFilenames(filenames)` | `name → id` map |
| `getSearchSuggestions` | `async getSearchSuggestions(query)` | `LIKE` + visibility |
| `listFavorites` | `async listFavorites()` | `is_favorite=1 AND type='audio'` |
| `getChanges` / `createChangeset` / `finalizeChangeset` / `addToChangeset` / `inspectChangeset` / `listChangesets` / `preflightApply` / `applyChangeset` | changeset promotion | Delegates to repository |

Missing visibility rows are treated as `PRESENT` (`LEFT JOIN ... OR IS NULL`), matching `getVisibility` fallback.

### MediaScanner

`new MediaScanner({ repository, mediaRoots, callbacks, config })`

| Method | Description |
|--------|-------------|
| `scan()` | `incrementalSync` — compare `scanFileSystem` vs `findByDirPattern` (5000-row batches, `setImmediate` yield), `upsertFile`/`deleteFileById` via repository |
| `startWatcher()` | `fs.watch` per root (recursive) + 15-min periodic + 2s debounced rescan (30s grace) |
| `stopWatcher()` | Close watchers + intervals |
| `pause()` / `resume()` | `adaptiveController` calls on CPU >90% / mem <10% |
| `getStatus()` | `{isScanning, isPaused, isWatcherRunning, pendingRescan}` |
| `ensureFolder(path)` | `repository.ensureFolder` |
| `events` | `EventBus` (`scan.started`, `scan.completed`, `scan.error`, `scanner.paused`) |

Callbacks: `onNewFile`, `onFileUpdated` (thumb + FTS + recursive counts), `onFileDeleted`, `getBatchSize`, `shouldCompareByHash`, `recordMemoryUsage`, `buildThumbCache`, `broadcastStats`.

### MediaRepository

Abstract interface (`src/repository/MediaRepository.js` — 56 methods). Backend implements `SqliteMediaRepository` (`backend/src/repository/sqliteMediaRepository.js`, 622 lines) via `stmts` + `db.prepare`. Key groups: file/folder core, folder queries, visibility, changesets, file queries (visibility-joined), aggregation (scanner).

Raw escape hatches `query`/`queryOne`/`run`/`transaction` remain for transition (e.g. binary index).

### MockMediaRepository

`src/repository/MockMediaRepository.js` — in-memory implementation for tests (no SQLite).

```js
import { MediaEngine, MockMediaRepository } from '@homelab/media-engine';
const repo = new MockMediaRepository();
const engine = new MediaEngine({ repository: repo, mediaRoots: ['/media'], webId: 'test' });
repo.ensureFolder('Music');
repo.upsertFile({ id: '1', name: 'a.flac', type: 'audio', dir_id: repo.ensureFolder('Music'), size: 1000, mtime: Date.now() });
await engine.listFiles({ limit: 10 }); // → 1 item
```

### Scanner Utilities

| Export | Source | Description |
|--------|--------|-------------|
| `VIDEO_EXTS`, `AUDIO_EXTS`, `IMAGE_EXTS`, `detectType(ext)` | `scanner/constants.js` | Extension sets, type detection |
| `getFileId(relPath)`, `resolveFullPath(relPath, mediaRoots)`, `getRelPath(fullPath, mediaRoots)`, `computeContentHash` | `scanner/fileUtils.js` | `md5(relPath)` id, multi-root join, symlink-tolerant |
| `scanFileSystem(root, folderName)`, `streamFileSystem` | `scanner/walk.js` | Recursive `readdir` (async) |
| `getDuration`, `probeVideoMetadata`, `extractTags`, `parseTimestamp` | `scanner/probe.js` | `ffprobe` wrappers |
| `incrementalSync`, `enrichDurationsBatch`, `enrichMetadataBatch` | `scanner/sync.js` | Batch diff + `ffprobe` enrichment |

### Safety Guards

| Export | Source | Description |
|--------|--------|-------------|
| `assertSafePath(canonical, mediaRoots, relPath)` | `safety/pathGuard.js` | Throws `PATH_ESCAPE` if canonical escapes roots (symlink-aware fallback in `resolveFile`) |
| `assertVisible` | `safety/visibilityGuard.js` | Visibility guard |

`resolveFile` catches `PATH_ESCAPE` when `relPath` is scanner-controlled (no `..`) — allows symlinked roots like `homelab/Music → /home/CATIAA/Music`.

### Visibility & Changesets

Re-exported from `src/index.js`:

```js
import { ensureTables, getVisibility, setVisibility, isVisible, getChanges } from '@homelab/media-engine';
import { ensureChangesetTables, createChangeset, finalizeChangeset, addChangeToChangeset, getChangeset, listChangesets, applyChangeset, validatePromotionPath, detectConflicts, ENVIRONMENT_ORDER } from '@homelab/media-engine';
```

`ENVIRONMENT_ORDER = { beta:0, 'pre-release':1, pre:1, release:2 }` — sequential promotion only.

### Operations

| Export | Source | Description |
|--------|--------|-------------|
| `OperationLock` | `operations/lock.js` | Per-`fileId` async lock for `trash`/`purge`/`move`/`rename` |
| `createOperationResult`, `successResult`, `errorResult` | `operations/result.js` | `{ok, operation, code, fileId, previousState, newState}` |

`trash`/`purge`/`move`/`rename` acquire `OperationLock` then delegate (currently `NOT_IMPLEMENTED`).

### Events

`EventBus` (`src/events/EventBus.js`) — typed emitter for `scan.*`, `scanner.paused/resumed`; backend subscribes for SSE + thumbnail.

---

## File → Web Path

```
File on disk  (/home/CATIAA/homelab/Music/a.flac  — via symlink homelab/Music → /home/CATIAA/Music)
  → MediaScanner.scan()  →  scanFileSystem → find 113k files → incrementalSync → repository.upsertFile
  → frontend GET /api/files?folder_id=...  →  engine.listFiles()  →  SQLite (LEFT JOIN visibility)
  → frontend GET /stream/audio/:id  →  engine.resolve(id)  →  {fullPath, exists, blocked}
  → backend  res.sendFile(fullPath, {headers: getServeTarget().headers})  →  browser
```

Search: `files_fts` (FTS5 `unicode61 remove_diacritics 1`) + triggers (`files_ai/ad/au`) + `engine.searchFiles` (visibility-filtered).

All media file resolution goes through `MediaEngine` — `fileResolver.js` is deleted, zero `grep` hits in `backend/src`.

---

## Visibility Semantics

- Table `media_visibility(file_id, web_id, state, updated_at)` — PK `(file_id, web_id)`
- Missing row = `PRESENT` (both `getVisibility` fallback and `LEFT JOIN ... OR IS NULL` in `listFiles`/`searchFiles`/`getStats`/etc.)
- `state = 'DELETED'` → hidden from `listFiles`, `searchFiles`, `getSearchSuggestions`, `listFavorites`, `getBatchFiles`, `resolve` returns `{blocked:true}`
- `delete(fileId)` / `restore(fileId)` are soft (no FS), changeset promotion is explicit

---

## Filesystem Safety

- `resolveFile` does `join(mediaRoots[0], relPath)` → `realpath` → `assertSafePath`
- Symlinked roots are allowed when `relPath` is safe (no `..`, no leading `/`, no `\0`)
- All operations must go through `resolveFile`; direct `join(MEDIA_ROOT, relPath)` in routes is forbidden

---

## Project Structure

```
@media/homelab/media-engine/
├── package.json          # private, ESM, exports ".", "./visibility", "./changeset"
├── plan.md               # 13-phase production plan + transaction strategy
├── src/
│   ├── index.js          # barrel (50 exports)
│   ├── MediaEngine.js    # 244 lines, no direct DB
│   ├── MediaScanner.js   # 205 lines, watch + periodic
│   ├── scanner/          # constants, fileUtils, walk, probe, sync
│   ├── resolver/         # resolveFile
│   ├── safety/           # pathGuard, visibilityGuard
│   ├── visibility/       # visibility (soft-delete), changeset (promotion)
│   ├── operations/       # result, lock (trash/purge/move/rename stubs)
│   ├── events/           # EventBus
│   └── repository/       # MediaRepository (interface), MockMediaRepository
└── README.md
```

---

## Testing

```bash
# Sync validation (113k files)
node test/smoke-test-scanner.mjs
# → Files: 113903, Folders: 159, scan 0 inserted (DB in sync), pause/resume, EventBus — 0 mismatches

# Mock (no SQLite)
node -e "import {MediaEngine, MockMediaRepository} from './src/index.js'; const r=new MockMediaRepository(); const e=new MediaEngine({repository:r, mediaRoots:['/media'], webId:'test'}); ..."
```

`SqliteMediaRepository` vs `MockMediaRepository` — same contract, engine is DB-agnostic.

---

## Related

- Consumer: [`homelab-media-server`](../homelab-media-server) (`file:../../media-engine` in `backend/package.json`)
- Docs: `homelab-media-server/README.md`, `homelab-media-server/ARCHITECTURE.md`
- Version: `0.1.0` — `trash`/`purge`/`move`/`rename` are stubs (Phase 5/7)

