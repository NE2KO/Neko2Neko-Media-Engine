import { test } from 'node:test';
import assert from 'node:assert';
import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  parseTimestamp,
  getDuration,
  probeVideoMetadata,
  extractTags,
  extractCreationTime,
  probeWithConcurrency,
} from '../src/scanner/probe.js';

test('normalizeVideoCodec("h264") returns "h264"', () => {
  assert.strictEqual(normalizeVideoCodec('h264'), 'h264');
});

test('normalizeVideoCodec("avc1") returns "h264"', () => {
  assert.strictEqual(normalizeVideoCodec('avc1'), 'h264');
});

test('normalizeVideoCodec("hevc") returns "hevc"', () => {
  assert.strictEqual(normalizeVideoCodec('hevc'), 'hevc');
});

test('normalizeVideoCodec("av1") returns "av1"', () => {
  assert.strictEqual(normalizeVideoCodec('av1'), 'av1');
});

test('normalizeVideoCodec("vp9") returns "vp9"', () => {
  assert.strictEqual(normalizeVideoCodec('vp9'), 'vp9');
});

test('normalizeVideoCodec("unknown_codec") returns "unknown_codec"', () => {
  assert.strictEqual(normalizeVideoCodec('unknown_codec'), 'unknown_codec');
});

test('normalizeVideoCodec(null) returns "unknown"', () => {
  assert.strictEqual(normalizeVideoCodec(null), 'unknown');
});

test('normalizeAudioCodec("aac") returns "aac"', () => {
  assert.strictEqual(normalizeAudioCodec('aac'), 'aac');
});

test('normalizeAudioCodec("mp3") returns "mp3"', () => {
  assert.strictEqual(normalizeAudioCodec('mp3'), 'mp3');
});

test('normalizeAudioCodec("opus") returns "opus"', () => {
  assert.strictEqual(normalizeAudioCodec('opus'), 'opus');
});

test('normalizeAudioCodec("flac") returns "flac"', () => {
  assert.strictEqual(normalizeAudioCodec('flac'), 'flac');
});

test('normalizeAudioCodec("pcm_s16le") returns "pcm"', () => {
  assert.strictEqual(normalizeAudioCodec('pcm_s16le'), 'pcm');
});

test('normalizeAudioCodec("unknown") returns ""', () => {
  assert.strictEqual(normalizeAudioCodec('unknown'), '');
});

test('parseTimestamp parses ISO dates', () => {
  const ts = parseTimestamp('2024-01-15T10:30:00');
  assert.ok(ts !== null);
  assert.strictEqual(typeof ts, 'number');
  assert.ok(ts > 0);
});

test('parseTimestamp parses space-separated dates', () => {
  const ts = parseTimestamp('2024:01:15 10:30:00');
  assert.ok(ts !== null);
  assert.strictEqual(typeof ts, 'number');
  assert.ok(ts > 0);
});

test('parseTimestamp returns null for invalid input', () => {
  assert.strictEqual(parseTimestamp('not-a-date'), null);
});

test('parseTimestamp returns null for null input', () => {
  assert.strictEqual(parseTimestamp(null), null);
});

test('getDuration returns 0 for non-existent file', async () => {
  const duration = await getDuration('/nonexistent/path/video.mp4');
  assert.strictEqual(duration, 0);
});

test('probeVideoMetadata returns null for non-existent file', async () => {
  const meta = await probeVideoMetadata('/nonexistent/path/video.mp4');
  assert.strictEqual(meta, null);
});

test('extractTags returns null for non-existent file', async () => {
  const tags = await extractTags('/nonexistent/path/video.mp4');
  assert.strictEqual(tags, null);
});

test('extractCreationTime returns null for non-existent file', async () => {
  const ts = await extractCreationTime('/nonexistent/path/video.mp4');
  assert.strictEqual(ts, null);
});

test('probeWithConcurrency returns results for all files and respects limit', async () => {
  const files = [
    '/nonexistent/path/video1.mp4',
    '/nonexistent/path/video2.mp4',
    '/nonexistent/path/video3.mp4',
  ];

  const results = await probeWithConcurrency(files, 2);

  assert.strictEqual(results.length, 3);
  for (let i = 0; i < results.length; i++) {
    assert.strictEqual(results[i].file, files[i]);
    assert.strictEqual(results[i].result, null);
  }
});
