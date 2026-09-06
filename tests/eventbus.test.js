import { test } from 'node:test';
import assert from 'node:assert';
import { EventBus } from '../src/events/EventBus.js';

test('on registers handler and returns unsubscribe function', () => {
  const bus = new EventBus();
  let called = false;
  const unsub = bus.on('evt', () => { called = true; });
  assert.strictEqual(typeof unsub, 'function');
  unsub();
  bus.emit('evt');
  assert.strictEqual(called, false);
});

test('emit calls handler with correct data', () => {
  const bus = new EventBus();
  let received = null;
  bus.on('evt', (data) => { received = data; });
  bus.emit('evt', { foo: 'bar' });
  assert.deepStrictEqual(received, { foo: 'bar' });
});

test('once calls handler once then unsubscribes', () => {
  const bus = new EventBus();
  let count = 0;
  bus.once('evt', () => { count++; });
  bus.emit('evt');
  bus.emit('evt');
  assert.strictEqual(count, 1);
});

test('once unsub works even if called before fire', () => {
  const bus = new EventBus();
  let count = 0;
  const unsub = bus.once('evt', () => { count++; });
  unsub();
  bus.emit('evt');
  assert.strictEqual(count, 0);
});

test('removeAllListeners removes all handlers for an event', () => {
  const bus = new EventBus();
  let count = 0;
  bus.on('evt', () => { count++; });
  bus.on('evt', () => { count++; });
  bus.removeAllListeners('evt');
  bus.emit('evt');
  assert.strictEqual(count, 0);
});

test('removeAllListeners() with no arg removes all events', () => {
  const bus = new EventBus();
  let a = 0;
  let b = 0;
  bus.on('a', () => { a++; });
  bus.on('b', () => { b++; });
  bus.removeAllListeners();
  bus.emit('a');
  bus.emit('b');
  assert.strictEqual(a, 0);
  assert.strictEqual(b, 0);
});

test('handler failure does not crash emit — other handlers still fire', () => {
  const bus = new EventBus();
  const results = [];
  bus.on('evt', () => { throw new Error('fail'); });
  bus.on('evt', () => { results.push(2); });
  bus.emit('evt');
  assert.deepStrictEqual(results, [2]);
});

test('handler failure is logged to console.error', () => {
  const bus = new EventBus();
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    bus.on('evt', () => { throw new Error('oops'); });
    bus.emit('evt');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0][0].includes('[EventBus]'));
  } finally {
    console.error = originalError;
  }
});

test('emit with no handlers does nothing', () => {
  const bus = new EventBus();
  assert.doesNotThrow(() => bus.emit('nonexistent'));
});

test('multiple handlers fire in registration order', () => {
  const bus = new EventBus();
  const order = [];
  bus.on('evt', () => { order.push(1); });
  bus.on('evt', () => { order.push(2); });
  bus.on('evt', () => { order.push(3); });
  bus.emit('evt');
  assert.deepStrictEqual(order, [1, 2, 3]);
});

test('unsub during emit is safe (defensive copy)', () => {
  const bus = new EventBus();
  const results = [];
  const unsub2 = bus.on('evt', () => { results.push(1); });
  const unsub3 = bus.on('evt', () => { results.push(2); unsub3(); });
  bus.on('evt', () => { results.push(3); });
  bus.emit('evt');
  assert.deepStrictEqual(results, [1, 2, 3]);
});
