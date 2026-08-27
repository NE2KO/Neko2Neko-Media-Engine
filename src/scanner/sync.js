import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getFileId, resolveFullPath, computeContentHash } from './fileUtils.js';
import { scanFileSystem } from './walk.js';
import { getDuration, probeVideoMetadata, extractCreationTime } from './probe.js';

export async function incrementalSync({
  repository,
  mediaRoots,
  onNewFile,
  onFileUpdated,
  onFileDeleted,
  getBatchSize,
  shouldCompareByHash,
  recordMemoryUsage,
  skipThumbCache = false,
}) {
  const BATCH_SIZE_BASE = 250;
  const batchSize = getBatchSize ? getBatchSize() : BATCH_SIZE_BASE;
  const useDirectRoot = mediaRoots.length === 1;
  const validRootNames = mediaRoots.map(r => basename(r));
  const SCAN_TIMESTAMP_FILE = join(process.cwd(), 'data', '.last-scan-time');

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;
  let folderDel = 0;

  for (const root of mediaRoots) {
    const folderName = useDirectRoot ? '' : basename(root);
    console.log(`[scanner] Processing root: ${useDirectRoot ? 'direct to root' : folderName}`);

    await repository.ensureFolder(folderName);

    const _t1 = Date.now();
    const fsEntries = await scanFileSystem(root, folderName, { recursive: true });
    const fsTime = Date.now() - _t1;
    console.log(`[scanner] Found ${fsEntries.length} media files in ${useDirectRoot ? 'root' : folderName}`);

    const _t2 = Date.now();
    const subfolderPattern = useDirectRoot ? '%' : folderName + '/%';
    const existingIds = new Set();
    const existingLookup = new Map();
    const DB_BATCH = 5000;
    let dbOffset = 0;
    while (true) {
      const batch = await repository.findByDirPattern(folderName, subfolderPattern, DB_BATCH, dbOffset);
      if (batch.length === 0) break;
      for (const row of batch) {
        existingIds.add(row.id);
        existingLookup.set(row.id, { size: row.size, mtime: row.mtime, dir_id: row.dir_id, duration: row.duration, checksum: row.checksum });
      }
      dbOffset += DB_BATCH;
      await new Promise(r => setImmediate(r));
    }
    if (recordMemoryUsage) {
      recordMemoryUsage('scanner', Buffer.byteLength(JSON.stringify({ existingLookup: Array.from(existingLookup.keys()), fsEntries: fsEntries.length })));
    }
    const dbTime = Date.now() - _t2;

    const folderPaths = new Set([folderName]);
    for (const entry of fsEntries) {
      const slashIdx = entry.relPath.lastIndexOf('/');
      if (slashIdx > 0) {
        const subFolderPath = entry.relPath.substring(0, slashIdx);
        if (useDirectRoot) {
          folderPaths.add(subFolderPath);
        } else {
          folderPaths.add(folderName + '/' + subFolderPath);
        }
      } else if (useDirectRoot) {
        folderPaths.add('');
      }
    }

    for (const p of folderPaths) {
      await repository.ensureFolder(p);
    }

    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const _t3 = Date.now();
    for (let i = 0; i < fsEntries.length; i += batchSize) {
      const batchSlice = fsEntries.slice(i, i + batchSize);
      for (const entry of batchSlice) {
        const existing = existingLookup.get(entry.id);
        if (existing && existing.size === entry.size && existing.mtime === entry.mtime) {
          const useHashCheck = shouldCompareByHash ? shouldCompareByHash() : false;
          if (useHashCheck && existing.checksum) {
            const currentHash = await computeContentHash(entry.fullPath, entry.size);
            if (currentHash && currentHash === existing.checksum) {
              skipped++;
              existingIds.delete(entry.id);
              continue;
            }
          } else {
            skipped++;
            existingIds.delete(entry.id);
            continue;
          }
        }

        const slashIdx = entry.relPath.lastIndexOf('/');
        let folderPath;
        if (useDirectRoot) {
          folderPath = slashIdx > 0 ? entry.relPath.substring(0, slashIdx) : '';
        } else {
          folderPath = slashIdx > 0 ? entry.relPath.substring(0, slashIdx) : folderName;
        }
        const dirId = await repository.ensureFolder(folderPath);

        if (existing) {
          updated++;
          await repository.upsertFile({
            id: entry.id,
            dir_id: dirId,
            name: entry.name,
            type: entry.type,
            ext: entry.ext,
            size: entry.size,
            mtime: entry.mtime,
            duration: existing.duration ?? 0,
            has_thumb: existing.has_thumb || 0,
            thumb_cache_path: existing.thumb_cache_path || null,
            last_accessed: 0,
            access_count: 0,
            last_verified: now,
            created_at: existing.created_at || entry.birthtime || entry.mtime,
            created_at_embedded: existing.created_at_embedded || null,
            modified_at_fs: entry.mtime,
            uploaded_at: existing.uploaded_at || null,
            metadata_source: existing.metadata_source || null,
            checksum: entry.checksum || existing.checksum || null,
          });
          if (entry.size !== existing.size) {
            await repository.updateFolderSize(dirId, entry.size - existing.size, now);
          }
          if (existing.created_at === existing.mtime && entry.birthtime && entry.birthtime !== existing.mtime) {
            await repository.updateCreatedAt(entry.id, entry.birthtime);
          }
        } else {
          inserted++;
          if (onNewFile) onNewFile(entry.fullPath, entry.type);
          await repository.upsertFile({
            id: entry.id,
            dir_id: dirId,
            name: entry.name,
            type: entry.type,
            ext: entry.ext,
            size: entry.size,
            mtime: entry.mtime,
            duration: 0,
            has_thumb: 0,
            thumb_cache_path: null,
            last_accessed: 0,
            access_count: 0,
            last_verified: now,
            created_at: entry.birthtime || entry.mtime,
            created_at_embedded: null,
            modified_at_fs: entry.mtime,
            uploaded_at: null,
            metadata_source: null,
            checksum: entry.checksum || null,
          });
          await repository.incrementFolderSize(dirId, entry.size, now);
        }
        existingIds.delete(entry.id);
      }
      if (i + batchSize < fsEntries.length) {
        await new Promise(r => setImmediate(r));
      }
    }
    const upsertTime = Date.now() - _t3;

    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;

    await new Promise(r => setImmediate(r));

    const _tClean = Date.now();
    if (existingIds.size > 0) {
      const orphanIds = [...existingIds];
      for (const id of orphanIds) {
        const file = await repository.getFileById(id);
        if (file) {
          await repository.decrementFolderSize(file.dir_id, file.size, now);
        }
        await repository.deleteFileById(id);
        if (onFileDeleted) onFileDeleted(id);
        totalDeleted++;
      }
    }
    const cleanTime = Date.now() - _tClean;

    const allFolders = await repository.getAllFolders();
    const staleFolderIds = [];
    for (const folder of allFolders) {
      if (folder.id === 1) continue;
      if (useDirectRoot) {
        const exists = existsSync(join(mediaRoots[0], folder.path));
        if (!exists) staleFolderIds.push(folder.id);
      } else {
        const rootName = folder.path.split('/')[0];
        if (!validRootNames.includes(rootName)) {
          staleFolderIds.push(folder.id);
        } else {
          const rootDir = mediaRoots.find(r => basename(r) === rootName);
          const subPath = folder.path.substring(rootName.length + 1);
          const exists = rootDir ? existsSync(join(rootDir, subPath)) : false;
          if (!exists) staleFolderIds.push(folder.id);
        }
      }
    }

    if (staleFolderIds.length > 0) {
      for (const id of staleFolderIds) {
        await repository.deleteFilesByFolder(id);
        await repository.deleteFolder(id);
        folderDel++;
      }
      console.log(`[scanner] Removed ${folderDel} stale folders`);
    }
  }

  const changed = (totalInserted + totalUpdated + totalDeleted + folderDel) > 0;
  const hashCheckEnabled = shouldCompareByHash ? shouldCompareByHash() : false;

  if (changed) {
    await repository.reconcileFolders();
    await repository.updateAllRecursiveCounts();
    if (onFileUpdated) onFileUpdated();
  }

  console.log(`[scanner] Sync complete: +${totalInserted} inserted, ~${totalUpdated} updated, •${totalSkipped} skipped, -${totalDeleted} deleted (hash_check=${hashCheckEnabled})`);
  if (!changed) {
    console.log(`[scanner] All files unchanged — DB is in sync with filesystem`);
  }
  try { writeFileSync(SCAN_TIMESTAMP_FILE, String(Date.now())); } catch {}

  return { inserted: totalInserted, updated: totalUpdated, skipped: totalSkipped, deleted: totalDeleted, changed, folderDel };
}

export async function enrichDurationsBatch({ repository, mediaRoots, resolveFullPath: resolveFn }) {
  const BATCH = 500;
  const MAX_PER_RUN = 6000;
  const TIME_BUDGET_MS = 2 * 60 * 1000;
  const start = Date.now();

  let processed = 0;
  let pending = BATCH;

  while (pending > 0 && processed < MAX_PER_RUN && (Date.now() - start) < TIME_BUDGET_MS) {
    const files = await repository.getFilesNeedingDuration(pending);
    pending = files.length;
    if (pending === 0) break;

    for (const file of files) {
      const relPath = file.path ? join(file.path, file.name) : file.name;
      const fullPath = resolveFn ? resolveFn(relPath, mediaRoots) : resolveFullPath(relPath, mediaRoots);
      if (file.type === 'video') {
        const probe = probeVideoMetadata(fullPath);
        if (probe) {
          await repository.updateCodecInfo(file.id, JSON.stringify(probe), probe.is_stream_compatible);
        }
      }
      const dur = await getDuration(fullPath);
      if (dur > 0) {
        const secs = Math.round(dur);
        await repository.updateDuration(file.id, secs);
        try { await repository.updatePlaylistTrackDurationByPath(secs, fullPath); } catch {}
      }
      processed++;
      if ((Date.now() - start) >= TIME_BUDGET_MS) break;
    }

    pending = BATCH;
  }

  try { await repository.refreshPlaylistTrackDurations(); } catch {}
  try { await repository.recomputeAllPlaylistTotals(); } catch {}

  return processed;
}

export async function enrichMetadataBatch({ repository, mediaRoots, resolveFullPath: resolveFn }) {
  const files = await repository.getFilesNeedingMetadata(20);
  let processed = 0;

  for (const file of files) {
    const relPath = file.path ? join(file.path, file.name) : file.name;
    const fullPath = resolveFn ? resolveFn(relPath, mediaRoots) : resolveFullPath(relPath, mediaRoots);
    const creationTime = await extractCreationTime(fullPath);
    if (creationTime) {
      await repository.updateCreatedAtEmbedded(file.id, creationTime, 'ffprobe');
    }
    processed++;
  }

  return processed;
}
