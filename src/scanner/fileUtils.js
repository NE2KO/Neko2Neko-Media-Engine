import { createHash } from 'node:crypto';
import { join, basename, dirname } from 'node:path';
import fs from 'node:fs';

export function getFileId(relPath) {
  return createHash('md5').update(relPath).digest('hex');
}

export function resolveFullPath(relPath, mediaRoots) {
  if (!relPath) return mediaRoots[0];
  if (mediaRoots.length === 1) {
    return join(mediaRoots[0], relPath);
  }
  const parts = relPath.split('/');
  const firstPart = parts[0];
  const root = mediaRoots.find(r => basename(r) === firstPart);
  if (root) {
    return join(dirname(root), relPath);
  }
  return join(mediaRoots[0], relPath);
}

export function getRelPath(fullPath, mediaRoots) {
  for (const root of mediaRoots) {
    if (fullPath.startsWith(root)) {
      const rel = fullPath.substring(root.length).replace(/^\/+/, '');
      return rel || basename(fullPath);
    }
  }
  return basename(fullPath);
}

export async function computeContentHash(filePath, size) {
  try {
    const SAMPLE = 65536;
    const h = createHash('md5');
    h.update(String(size));
    const fd = await fs.open(filePath, 'r');
    try {
      const buf1 = Buffer.allocUnsafe(Math.min(SAMPLE, size));
      await fd.read(buf1, 0, Math.min(SAMPLE, size), 0);
      h.update(buf1);
      if (size > SAMPLE * 2) {
        const buf2 = Buffer.allocUnsafe(SAMPLE);
        await fd.read(buf2, 0, SAMPLE, size - SAMPLE);
        h.update(buf2);
      }
    } finally {
      await fd.close();
    }
    return h.digest('hex');
  } catch {
    return null;
  }
}
