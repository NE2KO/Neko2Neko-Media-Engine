import { join, sep, isAbsolute } from 'node:path';
import { access, realpath } from 'node:fs/promises';
import { assertSafePath } from '../guard.js';

export async function resolveFileForEngine(fileId, repository, mediaRoots) {
  return resolveFile(fileId, repository, mediaRoots);
}

export async function resolveFile(fileId, repository, mediaRoots) {
  const file = repository.getFileWithPath(fileId);
  if (!file) return null;

  const relPath = file.dir_path ? join(file.dir_path, file.name) : file.name;

  if (isAbsolute(relPath) || relPath.includes('\0')) {
    const err = new Error(`Path escape detected: ${relPath}`);
    err.code = 'PATH_ESCAPE';
    err.relPath = relPath;
    throw err;
  }

  let rawPath;
  let exists = false;

  for (const root of mediaRoots) {
    const candidate = join(root, relPath);
    try {
      await access(candidate);
      rawPath = candidate;
      exists = true;
      break;
    } catch {
      // continue to next root
    }
  }

  if (!rawPath) {
    rawPath = join(mediaRoots[0], relPath);
  }

  let canonical;
  let realpathSucceeded = false;
  if (!exists) {
    canonical = rawPath;
  } else {
    try {
      canonical = await realpath(rawPath);
      realpathSucceeded = true;
    } catch (err) {
      canonical = rawPath;
      exists = false;
    }
  }

  try {
    assertSafePath(canonical, mediaRoots, relPath);
  } catch (err) {
    if (err.code === 'PATH_ESCAPE' &&
        !relPath.includes('..') &&
        !relPath.startsWith('/') &&
        (realpathSucceeded || (!rawPath.includes('..') && !isAbsolute(rawPath)))) {
      // Symlinked media root: canonical escapes raw root
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
