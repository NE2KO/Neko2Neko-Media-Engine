export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  emit(event, data) {
    const handlers = this._listeners.get(event);
    if (!handlers) return;

    const handlersCopy = new Set(handlers);
    for (const handler of handlersCopy) {
      try {
        handler(data);
      } catch (error) {
        console.error(`[EventBus] Event "${event}" handler error:`, error.message, '\n', error.stack);
      }
    }
  }

  once(event, handler) {
    const unsub = this.on(event, (data) => {
      unsub();
      handler(data);
    });
    return unsub;
  }

  removeAllListeners(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}
