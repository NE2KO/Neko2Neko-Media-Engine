import { readdir, stat, realpath, opendir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getFileId } from './fileUtils.js';
import { detectType } from './constants.js';

export async function* streamFileSystem(rootPath, rootRelPath = '', config = {}) {
  const queue = [{ dir: rootPath, relPath: rootRelPath }];

  while (queue.length > 0) {
    const { dir, relPath } = queue.shift();

    let dirHandle;
    try {
      dirHandle = await opendir(dir);
    } catch {
      continue;
    }

    const batch = [];
    for await (const dirent of dirHandle) {
      if (dirent.name.startsWith('.')) continue;
      const fullPath = join(dir, dirent.name);
      const itemRelPath = relPath ? join(relPath, dirent.name) : dirent.name;

      if (dirent.isSymbolicLink()) {
        try {
          const targetStat = await stat(fullPath);
          if (targetStat.isDirectory()) {
            queue.push({ dir: fullPath, relPath: itemRelPath });
          }
        } catch {}
        continue;
      }

      if (dirent.isDirectory()) {
        if (config.recursive !== false) {
          queue.push({ dir: fullPath, relPath: itemRelPath });
        }
        continue;
      }

      const ext = extname(dirent.name).toLowerCase();
      const type = detectType(ext);
      if (type === 'other') continue;

      batch.push({ dirent, fullPath, itemRelPath, type, ext });

      if (batch.length >= 16) {
        for (const r of await Promise.all(batch.map(processFileEntry))) {
          if (r) yield r;
        }
        batch.length = 0;
        await new Promise(r => setImmediate(r));
      }
    }

    for (const r of await Promise.all(batch.map(processFileEntry))) {
      if (r) yield r;
    }
    await new Promise(r => setImmediate(r));
  }
}

async function processFileEntry({ dirent, fullPath, itemRelPath, type, ext }) {
  try {
    const st = await stat(fullPath);
    let realFullPath;
    try { realFullPath = await realpath(fullPath); } catch { realFullPath = fullPath; }
    return {
      id: getFileId(itemRelPath),
      relPath: itemRelPath,
      name: dirent.name,
      type,
      ext,
      fullPath: realFullPath,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      birthtime: Math.floor(st.birthtimeMs) || Math.floor(st.mtimeMs),
    };
  } catch {
    return null;
  }
}

export async function scanFileSystem(rootPath, rootRelPath = '', config = {}) {
  const entries = [];
  for await (const entry of streamFileSystem(rootPath, rootRelPath, config)) {
    entries.push(entry);
  }
  return entries;
}
