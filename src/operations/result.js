export function createOperationResult({ ok, operation, code, fileId, previousState, newState, path, message }) {
  const result = {
    ok,
    operation,
    fileId,
    previousState,
    newState,
    timestamp: Date.now(),
  };
  if (code) result.code = code;
  if (path) result.path = path;
  if (message) result.message = message;
  return result;
}

export function successResult(operation, fileId, previousState, newState, path) {
  return createOperationResult({ ok: true, operation, fileId, previousState, newState, path });
}

export function errorResult(operation, fileId, code, message) {
  return createOperationResult({ ok: false, operation, fileId, code, message });
}
