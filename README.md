# @homelab/media-engine

[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](https://nodejs.org)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](#license)

**The single security boundary between your web applications and the filesystem for all media operations.**

`@homelab/media-engine` is a production-grade Node.js library and standalone gateway service. It owns the complete media lifecycle: discovery, safe resolution, visibility management, streaming, and storage. Your web layer never touches media paths, the filesystem, or storage internals — it asks the engine.

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
| **Per-User Visibility** | Soft-delete per user (`webId`). Deleted for one user, visible to another. |
| **Cross-Environment Changesets** | Promote media changes across environments (`beta` → `pre` → `release`). |
| **Multi-Web Gateway** | Single engine instance serves multiple web apps with per-app policies. |
| **Token-Based Streaming** | Signed, time-limited stream tokens. Web apps never see real paths. |
| **HTTP Range Requests** | `206 Partial Content` support for video seeking in browsers. |
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
┌──────────────────────────────────────────────────────┐
│  Web Application A (Movies) ───┐                     │
│  Web Application B (Music) ─────┤                     │
│  Web Application C (Admin) ─────┼──→ MediaEngine     │
│                                 │   (singleton)       │
│                                 │                     │
│  Each web app has its own:      │  • resolve()        │
│  - URL path prefix              │  • getServeTarget() │
│  - allowed_roots                │  • listFiles()      │
│  - allowed MIME types           │  • searchFiles()    │
│  - visibility scope (webId)     │  • token streaming  │
│                                 │  • range requests   │
│                                 │  • policy enforce   │
└─────────────────────────────────┴───────┬────────────┘
                                          │ repository interface calls
                                          ▼
                            ┌──────────────────────────┐
                            │  MediaRepository         │
                            │  (interface)             │
                            └──────────┬───────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                      ▼
        ┌──────────────────────┐               ┌──────────────────────────┐
        │ SqliteRepository     │               │ MockRepository (tests)    │
        │ better-sqlite3       │               │ in-memory Map             │
        │ FTS5, visibility,    │               │ zero external deps        │
        │ changesets           │               │                           │
        └──────────────────────┘               └──────────────────────────┘
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

### Multi-Web Gateway Mode (Recommended)

Run the engine as a central service. Multiple web apps connect to a single instance.

```js
import { MediaEngine, MediaScanner, loadConfig } from '@homelab/media-engine';
import { SqliteMediaRepository } from '@homelab/media-engine/repository/sqliteMediaRepository.js';

// 1. Load config from TOML
const { global, policies } = loadConfig('./config.toml');

// 2. Set up repository
const db = new Database('media.db');
const repository = new SqliteMediaRepository(db);

// 3. Create engine in multi-web mode
const engine = new MediaEngine({
  configPath: './config.toml',
  repository,
  mediaRoots: ['/media'],
});

// 4. Web app asks for stream URL (no paths leaked)
const result = await engine.getServeTarget('movie123', 'movies');
// → { success: true, streamUrl: '/api/stream?token=eyJpZCI6Im1vdmllMTIz...', metadata: { mimeType: 'video/mp4', size: 1500000000 } }

// 5. Client requests stream with signed token
app.get('/api/stream', async (req, res) => {
  await engine.handleStreamRequest(req.query.token, req, res);
});
```

### Legacy Single-Web Mode

For simple single-app deployments:

```js
import { MediaEngine, MediaScanner } from '@homelab/media-engine';
import { SqliteMediaRepository } from '@homelab/media-engine/repository/sqliteMediaRepository.js';

const db = new Database('media.db');
const repository = new SqliteMediaRepository(db);

// Single web app, direct stream return
const engine = new MediaEngine({
  webId: 'default',
  repository,
  mediaRoots: ['/path/to/media'],
});

// Resolve metadata (no paths)
const file = await engine.resolve('abc123');
console.log(file.name, file.size, file.mimeType);

// Get stream directly
const serveTarget = await engine.getServeTarget('abc123');
serveTarget.stream.pipe(res);
```

---

## Configuration

### `config.toml`

Create a `config.toml` in your engine working directory:

```toml
[global]
thumbnail_root = "./thumbnails"
scan_period_minutes = 15
scan_batch_size = 250
startup_grace_ms = 30000
probe_timeout = 15000

# HMAC secret for signing stream tokens.
# Generate with: openssl rand -hex 32
secret_key = "dev-only-change-in-production"

# ---------------------------------------------------------------------------
# Web policies: each section defines one web app that may access the engine.
# The engine enforces these policies on every stream request.
# ---------------------------------------------------------------------------

[web.movies]
path = "/movies"
allowed_roots = ["/media/movies"]
types = ["video/mp4", "video/x-matroska", "video/webm", "video/quicktime"]
# web_id is the visibility scope for soft-delete checks.
# If omitted, defaults to the section name ("movies").
web_id = "release-movies"

[web.music]
path = "/music"
allowed_roots = ["/media/music"]
types = ["audio/mpeg", "audio/flac", "audio/wav", "audio/ogg", "audio/aac", "image/jpeg", "image/png"]
web_id = "release-music"

[web.admin]
path = "/admin"
allowed_roots = ["/media"]
types = ["video/mp4", "video/x-matroska", "audio/mpeg", "audio/flac", "image/jpeg", "image/png", "application/octet-stream"]
web_id = "admin"
```

| Field | Description |
|-------|-------------|
| `global.secret_key` | HMAC secret for signing stream tokens. Use `openssl rand -hex 32` for production. |
| `global.thumbnail_root` | Central thumbnail cache directory. |
| `global.scan_period_minutes` | Scanner interval. |
| `global.scan_batch_size` | Files per batch during incremental sync. |
| `global.startup_grace_ms` | Ignore watcher events for this duration after startup. |
| `global.probe_timeout` | Default ffprobe timeout in milliseconds. |
| `web.<id>.path` | URL path prefix for this web app. |
| `web.<id>.allowed_roots` | Filesystem roots this web app may access. |
| `web.<id>.types` | Allowed MIME types. |
| `web.<id>.web_id` | Visibility scope (soft-delete namespace). Defaults to section name if omitted. |

### `loadConfig()`

```js
import { loadConfig } from '@homelab/media-engine';

const config = loadConfig('./config.toml');
// config.global.secretKey
// config.global.thumbnailRoot
// config.policies → Map<webId, { path, allowedRoots, types, webIdScope }>
```

Throws if `config.toml` is missing or `[global] secret_key` is absent.

---

## Core API Surface

### MediaEngine

The main entry point. Owns all media logic; delegates persistence to the repository.

| Method | Returns | Description |
|--------|---------|-------------|
| `resolve(fileId)` | `ResolvedFile \| { blocked: true } \| null` | Resolve metadata. Strips filesystem paths. Checks visibility. |
| `openMedia(fileId)` | `{ stream, mimeType, size, etag, lastModified }` | Open a readable stream for the media file. |
| `getServeTarget(fileId, webId?)` | `StreamTarget \| TokenTarget \| { error }` | Multi-web: returns signed token. Legacy: returns stream + headers. |
| `handleStreamRequest(token, req, res)` | `void` | Verify token and stream file with Range support. |
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

### Return Contracts

**Multi-web `getServeTarget()`**:

```ts
interface TokenTarget {
  success: true;
  streamUrl: string;       // e.g. '/api/stream?token=eyJpZCI6Im1vdmllMTIz...'
  metadata: {
    mimeType: string;
    size: number;
  };
}
```

**Legacy `getServeTarget()`**:

```ts
interface StreamTarget {
  stream: ReadableStream;        // Node.js readable stream
  size: number;                  // file size in bytes
  mimeType: string;              // e.g. 'audio/flac', 'video/mp4'
  etag: string;                  // file ID for cache validation
  lastModified: number;          // unix timestamp
  headers: Record<string, string>; // Cache-Control, Accept-Ranges
}
```

**`resolve()` contract (metadata only, no paths)**:

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

## Multi-Web Gateway

### How It Works

The engine runs as a **central gateway**. Multiple web applications connect to a single instance. Each web app gets its own policy defined in `config.toml`.

```
Web App A (Movies) ──┐
Web App B (Music) ───┼──→ MediaEngine (singleton)
Web App C (Admin) ───┘         ↓
                      resolve() / stream() / search()
                            ↓
                      SQLite DB + Filesystem
```

### Token-Based Streaming

Web apps never see raw filesystem paths. The engine returns **signed, time-limited tokens**:

```js
// Web app identifies itself by webId
const result = await engine.getServeTarget('movie123', 'movies');
// → { success: true, streamUrl: '/api/stream?token=eyJpZCI6Im1vdmllMTIz...', metadata: { mimeType: 'video/mp4', size: 1500000000 } }

// Web app forwards streamUrl to client/browser
// Client requests: GET /api/stream?token=eyJpZCI6Im1vdmllMTIz...

// Engine handles stream endpoint
app.get('/api/stream', async (req, res) => {
  await engine.handleStreamRequest(req.query.token, req, res);
});
```

**Security guarantees**:
- Web app never knows the real file path
- Tokens expire after 5 minutes
- Policy (`allowed_roots` + `types`) is enforced on every stream request
- HMAC-SHA256 signature prevents token forgery

### Policy Enforcement

Every `getServeTarget()` and `handleStreamRequest()` call enforces:

1. **Web app registration** — `webId` must exist in `config.toml`
2. **Allowed roots** — file's canonical path must be under one of the web app's `allowed_roots`
3. **MIME type allowlist** — file's MIME type must be in the web app's `types`
4. **Visibility check** — file must be `PRESENT` for the policy's `web_id` scope

If any check fails, the engine returns `{ error: 'FORBIDDEN' }` or HTTP `403`.

### HTTP Range Requests

`handleStreamRequest` supports `Range` headers (`206 Partial Content`), enabling video seeking in browsers:

```
Browser: GET /api/stream?token=xxx
         Header: Range: bytes=1048576-2097151

Engine:  Status: 206 Partial Content
         Header: Content-Range: bytes 1048576-2097151/1500000000
         Body: requested chunk
```

This works over both HTTP and HTTPS. For cross-origin setups, ensure CORS headers allow the `Range` header.

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

### Zero Path Leakage

The `resolve()` method always strips `fullPath` from its return value. Internal methods use `resolveFileForEngine()` which returns the full path, but this is never exposed to web applications.

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
    periodicMinutes: 15,     // full rescan interval
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
// The interface (~56 methods)
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

// Config loader
import { loadConfig } from '@homelab/media-engine';

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

// Safety guards
import { assertSafePath } from '@homelab/media-engine';
import { assertVisible } from '@homelab/media-engine';
```

---

## Project Status

**Version: 0.1.0** — Early production-ready release.

| Component | Status |
|-----------|--------|
| Multi-web gateway + TOML config | Stable |
| Token-based streaming + HMAC | Stable |
| HTTP Range requests (206) | Stable |
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
# Run all tests
npm test

# Mock-based tests only (no SQLite required)
node --test tests/media-engine.test.js tests/contract.test.js tests/changeset.test.js tests/eventbus.test.js tests/resolver.test.js tests/lock.test.js tests/scanner.test.js tests/probe.test.js

# SQLite integration tests
node --test tests/visibility.test.js
```

> **Note**: SQLite integration tests require a working `better-sqlite3` native binding for your Node.js version.

The `MockMediaRepository` allows full engine testing without any external dependencies.

---

## Requirements

- **Node.js** >= 18.0.0
- **ESM** only (`"type": "module"`)
- `better-sqlite3` (optional, only for SQLite backend)
- `smol-toml` (included, for TOML config parsing)

---

## License

MIT

---

## Related

- **Consumer example**: [homelab-media-server](https://github.com/your-org/homelab-media-server) — real-world Express integration
- **Architecture docs**: See `ARCHITECTURE.md` for the boundary model and design rationale
