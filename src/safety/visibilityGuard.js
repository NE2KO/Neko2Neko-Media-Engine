export function assertVisible(file) {
  if (file.blocked) {
    const err = new Error('Not available in this environment');
    err.code = 'BLOCKED_BY_VISIBILITY';
    err.fileId = file.id;
    throw err;
  }
}
