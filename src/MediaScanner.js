import { watch } from 'node:fs';
import { join, basename } from 'node:path';
import { EventBus } from './events/EventBus.js';
import { incrementalSync, enrichDurationsBatch, enrichMetadataBatch } from './scanner/sync.js';
import { resolveFullPath } from './scanner/fileUtils.js';
import { VIDEO_EXTS } from './scanner/constants.js';

export class MediaScanner {
  constructor({ repository, mediaRoots, callbacks = {}, config = {} }) {
    this.repository = repository;
    this.mediaRoots = mediaRoots;
    this.callbacks = callbacks;
    this.config = {
      workers: 4,
      compareByHash: false,
      periodicMinutes: 15,
      scanRecursive: true,
      ...config,
    };
    this.events = new EventBus();
    this._watchers = [];
    this._periodicInterval = null;
    this._scanTimeout = null;
    this._isScanning = false;
    this._isPaused = false;
    this._pendingRescan = false;
    this._running = false;
    this._startTime = 0;
    this._STARTUP_GRACE_MS = 30000;
  }

  pause() {
    this._isPaused = true;
    this.events.emit('scanner.paused', { timestamp: Date.now() });
  }

  resume() {
    this._isPaused = false;
    this.events.emit('scanner.resumed', { timestamp: Date.now() });
  }

  async scan() {
    if (this._isScanning) return null;
    this._isScanning = true;
    this.events.emit('scan.started', { timestamp: Date.now() });

    try {
      const result = await incrementalSync({
        repository: this.repository,
        mediaRoots: this.mediaRoots,
        onNewFile: this.callbacks.onNewFile,
        onFileUpdated: () => {
          if (this.callbacks.buildThumbCache) {
            try { this.callbacks.buildThumbCache(); } catch {}
          }
          if (this.callbacks.syncFTSIndex) {
            this.callbacks.syncFTSIndex();
          }
          if (this.callbacks.updateAllRecursiveCounts) {
            this.callbacks.updateAllRecursiveCounts();
          }
        },
        onFileDeleted: this.callbacks.onFileDeleted,
        getBatchSize: () => {
          const workers = this.config.workers || 4;
          return Math.max(100, workers * 250);
        },
        shouldCompareByHash: () => this.config.compareByHash || false,
        recordMemoryUsage: this.callbacks.recordMemoryUsage,
        skipThumbCache: false,
      });

      this.events.emit('scan.completed', { ...result, timestamp: Date.now() });
      return result;
    } catch (error) {
      this.events.emit('scan.error', { error: error.message, timestamp: Date.now() });
      throw error;
    } finally {
      this._isScanning = false;
    }
  }

  startWatcher() {
    if (this._running) return;
    this._running = true;
    this._startTime = Date.now();
    console.log('[scanner] Starting file watcher on:', this.mediaRoots.join(', '));

    for (const root of this.mediaRoots) {
      try {
        const w = watch(root, { recursive: true }, (eventType, filename) => {
          if (filename && !filename.startsWith('.')) {
            this._debouncedRescan();
          }
        });
        w.on('error', (err) => { console.error(`[scanner] Error watching ${root}:`, err.message); });
        this._watchers.push(w);
      } catch (err) {
        console.error(`[scanner] Failed to watch ${root}:`, err.message);
      }
    }

    this._periodicInterval = setInterval(async () => {
      await this._runPeriodicScan();
    }, (this.config.periodicMinutes || 15) * 60 * 1000);
    setTimeout(() => this._runPeriodicScan().catch(() => {}), 6 * 60 * 1000);
  }

  stopWatcher() {
    if (!this._running) return;
    this._running = false;
    console.log('[scanner] Stopping file watcher...');

    for (const w of this._watchers) {
      try { w.close(); } catch {}
    }
    this._watchers = [];

    if (this._periodicInterval) {
      clearInterval(this._periodicInterval);
      this._periodicInterval = null;
    }

    if (this._scanTimeout) {
      clearTimeout(this._scanTimeout);
      this._scanTimeout = null;
    }

    console.log('[scanner] File watcher stopped');
  }

  async enrichDurations() {
    return enrichDurationsBatch({
      repository: this.repository,
      mediaRoots: this.mediaRoots,
      resolveFullPath,
    });
  }

  async enrichMetadata() {
    return enrichMetadataBatch({
      repository: this.repository,
      mediaRoots: this.mediaRoots,
      resolveFullPath,
    });
  }

  getStatus() {
    return {
      isScanning: this._isScanning,
      isPaused: this._isPaused,
      isWatcherRunning: this._running,
      pendingRescan: this._pendingRescan,
    };
  }

  _debouncedRescan() {
    if (Date.now() - this._startTime < this._STARTUP_GRACE_MS) return;
    clearTimeout(this._scanTimeout);
    this._scanTimeout = setTimeout(async () => {
      if (this._isScanning) { this._pendingRescan = true; return; }
      this._isScanning = true;
      try {
        await this.scan();
      } finally {
        this._isScanning = false;
        if (this._pendingRescan) {
          this._pendingRescan = false;
          this._debouncedRescan();
        }
      }
    }, 2000);
  }

  async _runPeriodicScan() {
    if (this._isScanning) {
      this._pendingRescan = true;
      return null;
    }
    this._isScanning = true;
    try {
      const result = await this.scan();
      if (this.callbacks.broadcastStats) {
        this.callbacks.broadcastStats();
      }
      if (this.callbacks.broadcastFolderUpdate) {
        await this.callbacks.broadcastFolderUpdate('');
      }
      return result;
    } catch (err) {
      console.error('[scanner] Scan error:', err);
      return null;
    } finally {
      this._isScanning = false;
      if (this._pendingRescan) {
        this._pendingRescan = false;
        await this._runPeriodicScan();
      }
    }
  }

  ensureFolder(path) {
    return this.repository.ensureFolder(path);
  }
}
