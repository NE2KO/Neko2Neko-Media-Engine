export class OperationLock {
  constructor() {
    this._entries = new Map();
  }

  async acquire(fileId, operation) {
    let entry = this._entries.get(fileId);

    if (!entry) {
      entry = { locked: true, operation, queue: [] };
      this._entries.set(fileId, entry);
      return () => this._release(fileId);
    }

    if (!entry.locked) {
      entry.locked = true;
      entry.operation = operation;
      return () => this._release(fileId);
    }

    return new Promise(resolve => {
      entry.queue.push({ resolve, operation });
    });
  }

  isLocked(fileId) {
    const entry = this._entries.get(fileId);
    return entry !== undefined && entry.locked;
  }

  getOperation(fileId) {
    const entry = this._entries.get(fileId);
    return entry && entry.locked ? entry.operation : null;
  }

  _release(fileId) {
    const entry = this._entries.get(fileId);
    if (!entry || !entry.locked) return;

    const next = entry.queue.shift();
    if (next) {
      entry.operation = next.operation;
      next.resolve(() => this._release(fileId));
    } else {
      this._entries.delete(fileId);
    }
  }
}
