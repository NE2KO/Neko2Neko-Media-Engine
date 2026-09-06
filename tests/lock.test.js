import { test } from 'node:test';
import assert from 'node:assert';
import { OperationLock } from '../src/operations/lock.js';

test('acquire returns release function immediately when unlocked', async () => {
  const lock = new OperationLock();
  const release = await lock.acquire('file1', 'scan');
  assert.strictEqual(typeof release, 'function');
  release();
});

test('acquire blocks until released when already locked', async () => {
  const lock = new OperationLock();
  const release1 = await lock.acquire('file1', 'scan');
  let resolved = false;
  const promise = lock.acquire('file1', 'probe').then(() => { resolved = true; });
  assert.strictEqual(resolved, false);
  release1();
  await promise;
  assert.strictEqual(resolved, true);
});

test('isLocked returns true while locked, false after release', async () => {
  const lock = new OperationLock();
  assert.strictEqual(lock.isLocked('file1'), false);
  const release = await lock.acquire('file1', 'scan');
  assert.strictEqual(lock.isLocked('file1'), true);
  release();
  assert.strictEqual(lock.isLocked('file1'), false);
});

test('getOperation returns the operation name while locked, null when unlocked', async () => {
  const lock = new OperationLock();
  assert.strictEqual(lock.getOperation('file1'), null);
  const release = await lock.acquire('file1', 'scan');
  assert.strictEqual(lock.getOperation('file1'), 'scan');
  release();
  assert.strictEqual(lock.getOperation('file1'), null);
});

test('releasing an unlocked key is safe (no throw)', async () => {
  const lock = new OperationLock();
  assert.doesNotThrow(() => lock._release('nonexistent'));
});

test('multiple different fileIds can be locked concurrently', async () => {
  const lock = new OperationLock();
  const release1 = await lock.acquire('file1', 'scan');
  const release2 = await lock.acquire('file2', 'probe');
  assert.strictEqual(lock.isLocked('file1'), true);
  assert.strictEqual(lock.isLocked('file2'), true);
  release1();
  assert.strictEqual(lock.isLocked('file1'), false);
  assert.strictEqual(lock.isLocked('file2'), true);
  release2();
  assert.strictEqual(lock.isLocked('file2'), false);
});

test('FIFO ordering — waiters are served in order', async () => {
  const lock = new OperationLock();
  const release1 = await lock.acquire('file1', 'op1');
  const order = [];
  const p2 = lock.acquire('file1', 'op2').then((r2) => { order.push(2); return r2; });
  const p3 = lock.acquire('file1', 'op3').then((r3) => { order.push(3); return r3; });
  release1();
  const release2 = await p2;
  assert.deepStrictEqual(order, [2]);
  release2();
  await p3;
  assert.deepStrictEqual(order, [2, 3]);
});

test('double release is safe (second release is no-op)', async () => {
  const lock = new OperationLock();
  const release = await lock.acquire('file1', 'scan');
  release();
  assert.strictEqual(lock.isLocked('file1'), false);
  assert.doesNotThrow(() => release());
  assert.strictEqual(lock.isLocked('file1'), false);
});

test('concurrent acquire/release for same key works correctly', async () => {
  const lock = new OperationLock();
  const release1 = await lock.acquire('file1', 'op1');
  const p2 = lock.acquire('file1', 'op2');
  release1();
  const release2 = await p2;
  assert.strictEqual(lock.isLocked('file1'), true);
  assert.strictEqual(lock.getOperation('file1'), 'op2');
  release2();
  assert.strictEqual(lock.isLocked('file1'), false);
});

test('operation name is tracked correctly', async () => {
  const lock = new OperationLock();
  const release = await lock.acquire('file1', 'probe');
  assert.strictEqual(lock.getOperation('file1'), 'probe');
  release();
  assert.strictEqual(lock.getOperation('file1'), null);
});
