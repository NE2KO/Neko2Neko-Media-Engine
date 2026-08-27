import { join, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { assertSafePath } from '../guard.js';

export async function resolveFile(fileId, repository, mediaRoots) {
  const file = repository.getFileWithPath(fileId);
  if (!file) return null;

  const relPath = file.dir_path ? join(file.dir_path, file.name) : file.name;
  const rawPath = join(mediaRoots[0], relPath);

  let canonical;
  let exists = true;
  try {
    canonical = await realpath(rawPath);
  } catch (err) {
    canonical = rawPath;
    exists = false;
  }

  assertSafePath(canonical, mediaRoots, relPath);

  return {
    id: file.id,
    name: file.name,
    dirPath: file.dir_path,
    relPath,
    fullPath: canonical,
    exists,
    type: file.type,
    ext: file.ext,
    size: file.size,
    mtime: file.mtime,
    duration: file.duration,
    hasThumb: file.has_thumb,
    thumbCachePath: file.thumb_cache_path,
  };
}
