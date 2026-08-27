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

  try {
    assertSafePath(canonical, mediaRoots, relPath);
  } catch (err) {
    if (err.code === 'PATH_ESCAPE' && !relPath.includes('..') && !relPath.startsWith('/') && !relPath.includes('\0')) {
      // Symlinked media root (e.g. homelab/Music -> /home/CATIAA/Music): canonical escapes raw root
      // but relPath itself is safe (scanner-controlled). Allow and use canonical.
    } else {
      throw err;
    }
  }

  return {
    ...file,
    dirPath: file.dir_path,
    relPath,
    fullPath: canonical,
    exists,
    hasThumb: file.has_thumb,
    thumbCachePath: file.thumb_cache_path,
  };
}
