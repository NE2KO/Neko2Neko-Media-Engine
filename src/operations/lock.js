export class OperationLock {
  constructor() {
    this._locks = new Map();
  }

  async acquire(fileId, operation) {
    while (this._locks.has(fileId)) {
      await new Promise(r => setTimeout(r, 10));
    }
    this._locks.set(fileId, operation);
    return () => this._locks.delete(fileId);
  }

  isLocked(fileId) {
    return this._locks.has(fileId);
  }

  getOperation(fileId) {
    return this._locks.get(fileId) || null;
  }
}
