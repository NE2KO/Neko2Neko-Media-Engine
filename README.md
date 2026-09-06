# @homelab/media-engine

[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](https://nodejs.org)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](#license)

**The single security boundary between your web application and the filesystem for all media operations.**

`@homelab/media-engine` is a production-grade Node.js library that owns the complete media lifecycle: discovery, safe resolution, visibility management, streaming, and storage. Your web layer never touches media paths, the filesystem, or storage internals — it asks the engine.

---

## Why media-engine?

Most web applications that serve media either:

- **Leak filesystem paths** into route handlers, creating security vulnerabilities
- **Duplicate resolution logic** across services, leading to inconsistency
- **Mingle media concerns** with HTTP concerns, making testing impossible

`media-engine` solves this by enforcing a strict **single media boundary**:

```
Web Application
     ↓  (opaque IDs, streams, resources)
Media Engine  ← the ONLY component that touches media paths / filesystem
     ↓
Repository  (pluggable storage layer)
     ↓
Filesystem / Database
```

The backend stays **filesystem-blind**. It receives streams, metadata objects, and opaque IDs — never raw paths.

---

## Key Features

| Feature | Benefit |
|---------|---------|
| **Single Media Boundary** | Only the engine touches media paths. Web apps use opaque IDs. |
| **Path Traversal Protection** | Symlink-aware canonicalization, `..` rejection, null-byte guards. |
| **Per-User Visibility** | Soft-delete per user (webId). Deleted for one user, visible to another. |
| **Cross-Environment Changesets** | Promote media changes across environments (beta → pre → release). |
| **Streaming-First API** | Returns Node.js Readable streams with correct MIME types and cache headers. |
| **Incremental Scanner** | Efficient filesystem discovery with debounced watcher, periodic rescan, and adaptive CPU backpressure. |
| **FTS Search** | Full-text search via FTS5, visibility-filtered, with cursor pagination. |
| **Batch Operations** | Efficient bulk lookups, metadata updates, and filename resolution. |
| **Event Bus** | Typed events for scan lifecycle, scanner state changes, and custom hooks. |
| **Pluggable Storage** | Repository interface; SQLite implementation included, Mock for tests. |
| **Zero Core Dependencies** | Only `better-sqlite3` for the SQLite backend. No other runtime deps. |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Web Application (Express, Fastify, Hono, etc.)     │
│  Uses: engine.resolve(), engine.getServeTarget()     │
│        engine.listFiles(), engine.openMedia()        │
└──────────────────────┬──────────────────────────────┘
                       │ opaque IDs, streams, metadata
                       ▼
┌─────────────────────────────────────────────────────┐
│  MediaEngine                                        │
│  • resolve(fileId) → metadata (no paths)            │
│  • openMedia(fileId) → { stream, mimeType, size }   │
│  • getServeTarget(fileId) → { stream, headers }     │
│  • listFiles() / searchFiles() / getStats()         │
│  • Visibility guard, changeset promotion             │
│  • Path validation (assertSafePath)                  │
└──────────────────────┬──────────────────────────────┘
                       │ repository interface calls
                       ▼
┌─────────────────────────────────────────────────────┐
│  MediaRepository (interface)                         │
│  getFileById, upsertFile, isVisible, listFiles, ... │
└──────────────┬──────────────────────┬────────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────┐   ┌──────────────────────────┐
│ SqliteRepository     │   │ MockRepository (tests)    │
│ better-sqlite3       │   │ in-memory Map             │
│ FTS5, visibility,    │   │ zero external deps        │
│ changesets           │   │                           │
└──────────────────────┘   └──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  Filesystem                                         │
│  Media roots (single or multi-root, symlink-safe)   │
└─────────────────────────────────────────────────────┘
```

---

## Installation

```bash
npm install @homelab/media-engine
```

> **Note**: The SQLite backend requires `better-sqlite3`. Install it as a peer dependency if you need persistence:
>
> ```bash
> npm install better-sqlite3
> ```

---

## Quick Start

```js
import { MediaEngine, MediaScanner } from '@homelab/media-engine';
import { SqliteMediaRepository } from '@homelab/media-engine/repository/sqliteMediaRepository.js';

// 1. Set up your repository (storage layer)
const db = new Database('media.db'); // better-sqlite3
const repository = new SqliteMediaRepository(db);

// 2. Create the engine (single instance per process)
const engine = new MediaEngine({
  repository,
  mediaRoots: ['/path/to/media'],  // single or multiple roots
  webId: 'default',                // visibility scope
});

// 3. Resolve a file by ID (returns metadata, NO paths)
const file = await engine.resolve('abc123');
console.log(file.name, file.size, file.mimeType);

// 4. Get a stream to serve the file
const serveTarget = await engine.getServeTarget('abc123');
// serveTarget.stream → Node.js Readable stream
// serveTarget.headers → { 'Cache-Control': 'public, max-age=86400, immutable', 'Accept-Ranges': 'bytes' }
res.sendFile?.(serveTarget.path, { headers: serveTarget.headers });
// Or pipe the stream directly:
serveTarget.stream.pipe(res);

// 5. List files with visibility, pagination, and filtering
const files = await engine.listFiles({
  folderId: 'folder_xyz',
  type: 'audio',
  sortBy: 'name',
  sortOrder: 'asc',
  limit: 50,
  cursor: 'next_page_token',
});

// 6. Search with full-text search
const results = await engine.searchFiles('queen bohemian', {
  type: 'audio',
  limit: 20,
});
```

---

## Core API Surface

### MediaEngine

The main entry point. Owns all media logic; delegates persistence to the repository.

| Method | Returns | Description |
|--------|---------|-------------|
| `resolve(fileId)` | `File \| { blocked: true } \| null` | Resolve metadata. Strips filesystem paths. Checks visibility. |
| `openMedia(fileId)` | `{ stream, mimeType, size, etag, lastModified }` | Open a readable stream for the media file. |
| `getServeTarget(fileId)` | `{ stream, size, mimeType, etag, lastModified, headers } \| { error }` | Ready-to-use response object for HTTP serving. |
| `stat(fileId)` | `{ size, mtime, exists } \| null` | Lightweight existence check without streaming. |
| `isVisible(fileId)` | `boolean` | Check visibility for the current `webId`. |
| `delete(fileId)` | `OperationResult` | Soft-delete (marks as deleted for this `webId`). |
| `restore(fileId)` | `OperationResult` | Restore a soft-deleted file. |
| `listFiles(options)` | `{ items, nextCursor, hasMore }` | Paginated, visibility-filtered file listing. |
| `searchFiles(query, options)` | `{ items, total? }` | FTS5-powered search, visibility-filtered. |
| `searchFolders(query, options)` | `Folder[]` | Folder path search. |
| `getFileMetadata(fileId)` | `FileMetadata` | Full metadata including dir_path, visibility, and custom fields. |
| `updateMetadata(fileId, updates)` | `boolean` | Whitelist-safe metadata updates. |
| `getStats()` | `{ totalFiles, byType }` | Visibility-aware statistics. |
| `getBatchFiles(ids)` | `{ items, missingIds }` | Efficient batch lookup by ID list. |
| `getChanges(sinceTimestamp)` | `Change[]` | Get visibility changes since a timestamp (for sync). |

### Streaming / Resource Model

The engine returns **opaque resources**, never raw filesystem paths:

```js
// ❌ NEVER: your app builds paths from user input
const path = `/media/${req.params.id}.mp3`;
res.sendFile(path); // ← path traversal risk!

// ✅ ALWAYS: your app asks the engine for a resource
const target = await engine.getServeTarget(req.params.id);
if (target.error) return res.status(404).json({ error: target.error });
res.sendFile(target.path, { headers: target.headers });
// Or, for streaming frameworks:
target.stream.pipe(response);
```

The `getServeTarget()` contract:

```ts
interface ServeTarget {
  stream: ReadableStream;        // Node.js readable stream
  size: number;                  // file size in bytes
  mimeType: string;              // e.g. 'audio/flac', 'video/mp4'
  etag: string;                  // file ID for cache validation
  lastModified: number;          // unix timestamp
  headers: Record<string, string>; // Cache-Control, Accept-Ranges
  path?: string;                 // optional absolute path (for res.sendFile)
}
```

The `resolve()` contract (metadata only, no paths):

```ts
interface ResolvedFile {
  id: string;
  name: string;
  type: 'audio' | 'video' | 'image';
  size: number;
  mtime: number;
  mimeType: string;
  dirPath: string;      // normalized directory path, no filesystem root
  ext: string;
  exists: boolean;
  // NO fullPath, NO absolute path
}
```

---

## Safety & Security

### Path Traversal Protection

All path resolution goes through `assertSafePath()`:

1. **Rejects `..` sequences** in user-supplied relative paths
2. **Rejects null bytes** (`\0`) and absolute paths
3. **Symlink-aware canonicalization** — `realpath()` resolves symlinks, then validates the canonical path stays within allowed roots
4. **Multi-root support** — searches across multiple media roots

```js
import { assertSafePath } from '@homelab/media-engine';

// Throws PATH_ESCAPE if canonical path is outside media roots
assertSafePath(canonicalPath, mediaRoots, relPath);
```

### Visibility Controls

Each user (`webId`) has independent visibility state. Files are never hard-deleted by default:

```js
// Soft-delete for user "alice"
await engine.delete(fileId); // → { state: 'DELETED', changeId: 'ch_xxx' }

// Restore for user "alice"
await engine.restore(fileId); // → { state: 'PRESENT', changeId: 'ch_yyy' }

// Check visibility
engine.isVisible(fileId); // → true / false

// File is invisible in engine.listFiles() and engine.searchFiles()
// when the current webId has it marked as DELETED
```

---

## Scanner

The incremental filesystem scanner discovers and syncs your media library:

```js
const scanner = new MediaScanner({
  repository,
  mediaRoots: ['/media/music', '/media/videos'],
  callbacks: {
    onNewFile: (fullPath, type) => generateThumbnail(fullPath, type),
    onFileUpdated: () => rebuildSearchIndex(),
    onFileDeleted: (fileId) => purgeCache(fileId),
    broadcastStats: () => io.emit('stats', scanner.getStatus()),
  },
  config: {
    workers: 4,              // parallel scanning workers
    periodicMinutes: 15,     // full rescan interval
    scanRecursive: true,     // recurse into subdirectories
  },
});

// Start filesystem watcher (fs.watch + periodic rescan)
scanner.startWatcher();

// Run an incremental sync
const result = await scanner.scan();
// → { inserted, updated, deleted, duration, errors }

// Pause during high load
scanner.pause();

// Resume
scanner.resume();

// Status
scanner.getStatus();
// → { isScanning, isPaused, isWatcherRunning, pendingRescan }
```

**Event Bus** — subscribe to scanner lifecycle events:

```js
engine.events.on('scan.started', (e) => console.log('Scan started', e.timestamp));
engine.events.on('scan.completed', (e) => console.log('Scan completed', e));
engine.events.on('scan.error', (e) => console.error('Scan error', e.error));
engine.events.on('scanner.paused', (e) => console.log('Scanner paused', e.timestamp));
engine.events.on('scanner.resumed', (e) => console.log('Scanner resumed', e.timestamp));
```

---

## Repository Pattern

The repository interface decouples the engine from storage. Swap SQLite for PostgreSQL, in-memory for tests, or a remote API:

```js
// The interface (56 methods)
class MediaRepository {
  // File operations
  getFileById(id)
  getFileWithPath(id)
  upsertFile(file)
  deleteFileById(id)

  // Folder operations
  getFolderById(id)
  ensureFolder(path)
  getFoldersByParent(parentId)

  // Visibility
  ensureVisibilityTables()
  isVisible(fileId, webId)
  setVisibilityState(fileId, webId, state)

  // Changesets
  ensureChangesetTables()
  createChangeset(webId, name, description)
  applyChangeset(changesetId, targetWebId)

  // Queries
  listFiles({ webId, folderId, type, limit, cursor })
  searchFiles({ webId, query, type, limit })
  getStats(webId)
  getBatchFiles(ids, webId)

  // Raw escape hatches (for migration/transitions)
  query(sql, params)
  transaction(fn)
}
```

**Built-in implementations:**

| Repository | Use Case |
|------------|----------|
| `SqliteMediaRepository` | Production SQLite via `better-sqlite3` |
| `MockMediaRepository` | In-memory testing, no external deps |

```js
// Test with mock — zero dependencies
import { MediaEngine, MockMediaRepository } from '@homelab/media-engine';

const repo = new MockMediaRepository();
const engine = new MediaEngine({ repository: repo, mediaRoots: ['/media'], webId: 'test' });

repo.ensureFolder('Music');
repo.upsertFile({
  id: '1',
  name: 'song.flac',
  type: 'audio',
  dir_id: repo.ensureFolder('Music'),
  size: 5000000,
  mtime: Date.now(),
});

await engine.listFiles({ limit: 10 }); // → [{ id: '1', name: 'song.flac', ... }]
```

---

## Subpath Exports

```js
// Main engine
import { MediaEngine, MediaScanner } from '@homelab/media-engine';

// Visibility (soft-delete, user-scoped)
import { getVisibility, setVisibility, isVisible, getChanges } from '@homelab/media-engine';

// Changesets (cross-environment promotion)
import {
  createChangeset,
  finalizeChangeset,
  addChangeToChangeset,
  listChangesets,
  applyChangeset,
  validatePromotionPath,
  detectConflicts,
  ENVIRONMENT_ORDER,
} from '@homelab/media-engine';
```

---

## Project Status

**Version: 0.1.0** — Early production-ready release.

| Component | Status |
|-----------|--------|
| Path resolution & safety guards | Stable |
| Visibility (per-user soft delete) | Stable |
| Incremental scanner + watcher | Stable |
| SQLite repository | Stable |
| Changeset promotion | Stable |
| FTS search | Stable |
| Cursor pagination | Stable |
| Batch operations | Stable |
| trash / purge / move / rename | Stubs (coming in 0.2.0) |

---

## Testing

```bash
# Run unit tests
npm test

# Mock-based tests (no SQLite required)
node --test src/**/*.test.js

# Integration with SQLite
node --test tests/**/*.test.js
```

The `MockMediaRepository` allows full engine testing without any external dependencies.

---

## Requirements

- **Node.js** >= 18.0.0
- **ESM** only (`"type": "module"`)
- `better-sqlite3` (optional, only for SQLite backend)

---

## License

MIT

---

## Related

- **Consumer example**: [homelab-media-server](https://github.com/your-org/homelab-media-server) — real-world Express integration
- **Architecture docs**: See `ARCHITECTURE.md` for the boundary model and design rationale
