export function assertVisible(file) {
  if (file.blocked) {
    const err = new Error('Not available in this environment');
    err.code = 'BLOCKED_BY_VISIBILITY';
    err.fileId = file.id;
    throw err;
  }
}

export function assertSafePath(canonicalPath, mediaRoots, relPath) {
  const safe = mediaRoots.some(root => {
    if (canonicalPath === root) return true;
    return canonicalPath.startsWith(root + '/');
  });
  if (!safe) {
    const err = new Error(`Path escape detected: ${relPath} → ${canonicalPath}`);
    err.code = 'PATH_ESCAPE';
    err.relPath = relPath;
    err.canonicalPath = canonicalPath;
    throw err;
  }
}
