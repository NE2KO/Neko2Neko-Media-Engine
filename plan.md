# @homelab/media-engine — Architecture Plan

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | No webId in core engine | Multiple consumers, not multi-tenant. Authorization on top. |
| 2 | trash()/restore()/purge() new methods | Don't break existing delete(). Deprecate later. |
| 3 | adaptiveController stays in backend | Server resource policy, not media domain. Scanner expose pause()/resume(). |
| 4 | SSE stays in backend | Transport layer. Engine has EventBus, backend subscribes + broadcasts. |
| 5 | Local file reference | `file:../../media-engine` in package.json. No npm publishing yet. |
| 6 | Scanner = read/discovery-oriented | No mutation in scanner. Operations are separate subsystem. |
| 7 | DB outside engine | Dependency injection via MediaRepository interface. |
| 8 | Consistent OperationResult | `{ ok, operation, code, fileId, previousState, newState }` |
| 9 | EventBus for decoupling | Engine emits events, backend subscribes for thumbnail/FTS/SSE. |
| 10 | Path safety as core | resolve() includes all guards. Operations always use resolver. |

## Target Structure

```
@homelab/media-engine/
├── package.json
├── src/
│   ├── index.js
│   ├── MediaEngine.js
│   ├── MediaScanner.js
│   ├── scanner/
│   │   ├── constants.js
│   │   ├── fileUtils.js
│   │   ├── walk.js
│   │   ├── sync.js
│   │   └── probe.js
│   ├── resolver/
│   │   └── resolveFile.js
│   ├── safety/
│   │   ├── pathGuard.js
│   │   ├── visibilityGuard.js
│   │   └── operationGuard.js
│   ├── operations/
│   │   ├── result.js
│   │   ├── trash.js
│   │   ├── restore.js
│   │   ├── purge.js
│   │   └── lock.js
│   ├── events/
│   │   └── EventBus.js
│   └── repository/
│       └── MediaRepository.js
```

## MediaRepository Interface

Backend implements this, engine consumes it:

```js
class MediaRepository {
  getById(id) {}
  upsert(file) {}
  deleteById(id) {}
  getFolderByPath(path) {}
  ensureFolder(path) {}
  countByType() {}
  findExisting(ids) {}
  getExistingByDir(dirId) {}
}
```

## MediaScanner API

```js
class MediaScanner {
  constructor({ repository, mediaRoots, callbacks, config })
  async scan() → { inserted, updated, deleted, elapsed }
  startWatcher() → void
  stopWatcher() → void
  pause() → void
  resume() → void
  async enrichDurations() → count
  async enrichMetadata() → count
  events → EventBus
}
```

## Backend Files Importing from fileScanner.js

| File | Imports |
|------|---------|
| `scannerWorker.js` | `incrementalSync` |
| `watcher.js` | `MEDIA_ROOTS`, `VIDEO_EXTS` |
| `thumbnailQueue.js` | `resolveFullPath`, `getFileId`, `getRelPath` |
| `uploadManager.js` | `detectType`, `getFileId`, `ensureFolder` |
| `fileResolver.js` | `resolveFullPath` |
| `maintenance.js` | `resolveFullPath`, `enrichDurationsBatch`, `enrichMetadataBatch` |
| `monitoring.js` | `getScannerStatus` |
| `metadata.js` | `resolveFullPath` |

## Execution Batches

### Batch 1: Core Gateway + Scanner (MVP)
1. Create package structure
2. Extract safety guards
3. Extract scanner modules
4. Create MediaScanner class
5. Refactor MediaEngine (remove webId, add repository interface)
6. Create repository interface
7. Update backend imports
8. Delete old files
9. Wire adaptiveController
10. Test scan

### Batch 2: Operations + Events
- trash/restore/purge + EventBus

### Batch 3: Move/Rename + Locking
- File relocation + operation serialization

### Batch 4: Safety + Tests
- Comprehensive tests + authorization layer

## Transaction Strategy

Operations that modify both DB and filesystem (trash, purge, move, rename) follow this pattern:

1. **Acquire OperationLock** — serialize per-file, prevent concurrent mutations
2. **Resolve file** — get current path, validate existence
3. **Begin DB transaction** — `repository.transaction(() => { ... })`
4. **Update DB state** — set visibility, update paths/counts
5. **Commit filesystem** — move/delete/rename on disk
6. **Release lock** — in `finally` block

If step 5 fails, the DB transaction rolls back (SQLite savespoint). If step 4 fails, filesystem is untouched. The OperationLock prevents race conditions during the window.

**Key rules:**
- Never hold a filesystem lock across a DB transaction — use lock → transaction → unlock
- Each operation is atomic at the DB level (transaction) and best-effort at filesystem level (with rollback)
- The `repository.transaction(fn)` method wraps `fn` in `db.transaction(fn)()` for SQLite
- For cross-repo operations (changeset apply), the target repository provides its own transaction
