import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, extname } from 'node:path';

export async function writeMetadata(filePath, updates) {
  const allowedFields = [
    'title', 'artist', 'album', 'genre', 'lyrics', 'lyrics_synced',
    'lyrics_romaji', 'cover_source', 'video_offset', 'youtube_id',
    'isFavorite', 'isLocked',
  ];
  const filtered = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      filtered[key] = value;
    }
  }
  if (!existsSync(filePath)) {
    return { ok: false, reason: 'file_missing' };
  }
  return { ok: true, written: Object.keys(filtered) };
}

export async function readMetadata(filePath) {
  if (!existsSync(filePath)) {
    throw new Error('FILE_MISSING');
  }

  const data = await probeTags(filePath);
  if (!data) return null;

  const formatTags = data.format?.tags || {};
  const streamTags = {};
  for (const stream of (data.streams || [])) {
    if (stream.tags) {
      Object.assign(streamTags, stream.tags);
    }
  }

  const tags = { ...formatTags, ...streamTags };
  const result = {};

  if (tags.title || tags.TITLE) result.title = tags.title || tags.TITLE;
  if (tags.artist || tags.ARTIST) result.artist = tags.artist || tags.ARTIST;
  if (tags.album || tags.ALBUM) result.album = tags.album || tags.ALBUM;
  if (tags.genre || tags.GENRE) result.genre = tags.genre || tags.GENRE;
  if (tags.date || tags.DATE || tags.creation_time) result.date = tags.date || tags.DATE || tags.creation_time;
  if (tags.comment || tags.COMMENT) result.comment = tags.comment || tags.COMMENT;
  if (tags.lyrics) result.lyrics = tags.lyrics;

  result.duration = parseFloat(data.format?.duration) || 0;
  result.bitrate = parseInt(data.format?.bit_rate, 10) || 0;
  result.format = data.format?.format_name || '';
  result.codec = (data.streams || []).filter(s => s.codec_type === 'audio').map(s => s.codec_name).join(', ');

  return result;
}

function probeTags(filePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath];
    let out = '';
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); }
      catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}

export async function embedCover(filePath, imageBuffer, mimeType) {
  if (!existsSync(filePath)) {
    throw new Error('FILE_MISSING');
  }

  const ext = extname(filePath).toLowerCase();
  const supportedExts = ['.mp3', '.m4a', '.mp4', '.m4v', '.mov', '.flac', '.wav'];
  if (!supportedExts.includes(ext)) {
    throw new Error('UNSUPPORTED_FORMAT');
  }

  const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  const imgExt = extMap[mimeType] || '.jpg';

  const tempDir = join(tmpdir(), 'media-engine-cover');
  mkdirSync(tempDir, { recursive: true });
  const tempImg = join(tempDir, `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${imgExt}`);
  const tempOut = join(tempDir, `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);

  try {
    writeFileSync(tempImg, imageBuffer);

    let codecArgs = ['-c', 'copy'];

    if (ext === '.mp3') {
      codecArgs = ['-c', 'copy', '-id3v2_version', '3', '-metadata:s:v', 'title=Cover', '-metadata:s:v', 'comment=Cover'];
    } else if (['.mp4', '.m4v', '.mov', '.m4a'].includes(ext)) {
      codecArgs = ['-c', 'copy', '-map', '0', '-map', '1', '-c:v:1', 'mjpeg'];
    } else if (ext === '.flac') {
      codecArgs = ['-c', 'copy', '-c:v', 'mjpeg'];
    } else if (ext === '.wav') {
      codecArgs = ['-c', 'copy', '-c:v', 'mjpeg'];
    }

    const args = [
      '-i', filePath,
      '-i', tempImg,
      '-y',
      ...codecArgs,
      '-metadata:s:v', 'title=Cover',
      tempOut,
    ];

    const result = await runFfmpeg(args, 60000);
    if (result.exitCode !== 0 && result.exitCode !== null) {
      throw new Error(`FFMPEG_FAILED: ${result.stderr}`);
    }

    const src = readFileSync(filePath);
    const dst = readFileSync(tempOut);
    writeFileSync(filePath, dst);

    return { ok: true };
  } finally {
    try { unlinkSync(tempImg); } catch {}
    try { unlinkSync(tempOut); } catch {}
  }
}

export function writeLyrics(filePath, lyrics) {
  if (!existsSync(filePath)) {
    throw new Error('FILE_MISSING');
  }

  const lrcPath = filePath.replace(extname(filePath), '.lrc');
  writeFileSync(lrcPath, lyrics);
  return { ok: true, path: lrcPath };
}

export async function readCover(filePath) {
  if (!existsSync(filePath)) {
    throw new Error('FILE_MISSING');
  }

  const ext = extname(filePath).toLowerCase();
  const supportedExts = ['.mp3', '.m4a', '.mp4', '.m4v', '.mov', '.flac', '.wav'];
  if (!supportedExts.includes(ext)) {
    throw new Error('UNSUPPORTED_FORMAT');
  }

  const tempDir = join(tmpdir(), 'media-engine-cover');
  mkdirSync(tempDir, { recursive: true });
  const tempOut = join(tempDir, `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);

  try {
    const args = [
      '-v', 'quiet',
      '-i', filePath,
      '-an', '-dn', '-sn',
      '-vframes', '1',
      '-f', 'image2',
      tempOut,
    ];

    const result = await runFfmpeg(args, 30000);
    if (result.exitCode !== 0 && result.exitCode !== null) {
      return null;
    }

    if (!existsSync(tempOut)) {
      return null;
    }

    const buffer = readFileSync(tempOut);
    return { buffer, mimeType: 'image/jpeg', size: buffer.length };
  } catch {
    return null;
  } finally {
    try { unlinkSync(tempOut); } catch {}
  }
}

function runFfmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        resolve({ exitCode: null, stderr: 'ffmpeg not found', notFound: true });
      } else {
        resolve({ exitCode: null, stderr: err.message });
      }
    });
  });
}
