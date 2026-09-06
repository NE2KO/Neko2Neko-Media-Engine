import { spawn } from 'node:child_process';
import { extname } from 'node:path';

const VIDEO_CANON = {
  h264: 'h264', avc1: 'h264', avc3: 'h264',
  hevc: 'hevc', h265: 'hevc', hev1: 'hevc', hvc1: 'hevc',
  av1: 'av1', av01: 'av1',
  vp9: 'vp9', vp09: 'vp9', vp8: 'vp8',
  mpeg4: 'mpeg4', mpeg2video: 'mpeg2', mjpeg: 'mjpeg',
};

const AUDIO_CANON = {
  aac: 'aac', mp4a: 'aac',
  opus: 'opus',
  mp3: 'mp3', mp3float: 'mp3',
  ac3: 'ac3', eac3: 'eac3', 'ac-3': 'ac3',
  vorbis: 'vorbis', flac: 'flac',
  pcm_s16le: 'pcm', pcm_s24le: 'pcm', pcm_s32le: 'pcm', pcm_f32le: 'pcm',
  alac: 'alac', amr_nb: 'amr', amr_wb: 'amr',
};

export function normalizeVideoCodec(name) {
  return VIDEO_CANON[(name || '').toLowerCase()] || (name || '').toLowerCase() || 'unknown';
}

export function normalizeAudioCodec(name) {
  return AUDIO_CANON[(name || '').toLowerCase()] || '';
}

export function getDuration(filePath) {
  return new Promise((resolve) => {
    try {
      const proc = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let out = '';
      proc.stdout.on('data', (chunk) => { out += chunk; });
      proc.on('close', () => {
        try {
          const data = JSON.parse(out);
          resolve(parseFloat(data.format?.duration) || 0);
        } catch { resolve(0); }
      });
      proc.on('error', () => resolve(0));
    } catch { resolve(0); }
  });
}

async function runFfprobe(filePath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_entries', 'format=format_name:stream=index,codec_type,codec_name,codec_tag_string,width,height,profile',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const exitCode = await new Promise((resolve) => {
      proc.on('close', (code) => resolve(code));
      proc.on('error', (err) => {
        if (err.code === 'ENOENT') resolve('ENOENT');
        else resolve('SPAWN_ERROR');
      });
    });

    if (exitCode !== 0) return null;
    if (!stdout || !stdout.trim()) return null;

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      return null;
    }

    const video = (data.streams || []).find(s => s.codec_type === 'video');
    const audio = (data.streams || []).find(s => s.codec_type === 'audio');
    if (!video) return null;

    const vCodec = (video.codec_name || '').toLowerCase();
    const vTag = (video.codec_tag_string || '').toLowerCase();
    const aCodec = (audio?.codec_name || '').toLowerCase();
    const aTag = (audio?.codec_tag_string || '').toLowerCase();
    const ext = extname(filePath).toLowerCase();
    const isMuxableBrowserContainer = ['.mp4', '.m4v', '.mov'].includes(ext);
    const codec = `${vCodec} ${vTag} ${aCodec} ${aTag}`.toLowerCase();
    const isH264 = /(^|\s)(avc1|h264)(\s|$)/.test(codec);
    const isHevc = /(^|\s)(hev1|hvc1|hevc)(\s|$)/.test(codec);
    const isCompatible = isMuxableBrowserContainer && (isH264 || isHevc);

    return {
      video_codec: vCodec,
      video_codec_tag: vTag,
      audio_codec: aCodec,
      audio_codec_tag: aTag,
      videoCodec: normalizeVideoCodec(vCodec),
      audioCodec: normalizeAudioCodec(aCodec),
      width: video.width || 0,
      height: video.height || 0,
      profile: video.profile || '',
      format: (data.format?.format_name || '').toLowerCase(),
      is_stream_compatible: isCompatible ? 1 : 0,
    };
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return null;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeVideoMetadata(filePath) {
  try {
    return await runFfprobe(filePath);
  } catch {
    return null;
  }
}

export async function probeWithConcurrency(files, limit = 2) {
  const results = [];
  const executing = [];
  let index = 0;

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 2;

  for (const file of files) {
    const task = (async () => {
      const result = await probeVideoMetadata(file);
      return { file, result };
    })();

    executing.push(task);

    if (executing.length >= safeLimit) {
      results.push(await executing.shift());
    }
  }

  while (executing.length > 0) {
    results.push(await executing.shift());
  }

  return results;
}

const TAG_DATE_PATTERNS = [
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
  /(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/,
  /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
];

const CREATION_TAG_NAMES = ['creation_time', 'DATE', 'Media_Create_Date', 'CreationDate'];

export function parseTimestamp(value) {
  if (!value) return null;
  for (const pat of TAG_DATE_PATTERNS) {
    const m = value.match(pat);
    if (m) {
      const d = new Date(m[1].replace(/(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.getTime();
}

export function extractTags(filePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_entries', 'format_tags:stream_tags', filePath];
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

export async function extractCreationTime(filePath) {
  const data = await extractTags(filePath);
  if (!data) return null;

  for (const tagName of CREATION_TAG_NAMES) {
    const ts = parseTimestamp(data.format?.tags?.[tagName]) || parseTimestamp(data.streams?.[0]?.tags?.[tagName]);
    if (ts) return ts;
  }
  return null;
}
