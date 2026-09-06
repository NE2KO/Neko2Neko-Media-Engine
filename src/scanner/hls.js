import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';

export async function generateHLSSegments(inputPath, workDir, options = {}) {
  if (!existsSync(inputPath)) {
    throw new Error('FILE_MISSING');
  }

  const opts = {
    segmentDuration: options.segmentDuration || 10,
    playlistName: options.playlistName || 'playlist.m3u8',
    segmentPattern: options.segmentPattern || 'segment_%03d.ts',
    videoBitrate: options.videoBitrate || '0',
    audioBitrate: options.audioBitrate || '128k',
    resolution: options.resolution || null,
    ...options,
  };

  mkdirSync(workDir, { recursive: true });
  const playlistPath = join(workDir, opts.playlistName);

  const args = [
    '-v', 'quiet',
    '-i', inputPath,
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', String(opts.segmentDuration),
    '-hls_list_size', '0',
    '-hls_segment_filename', opts.segmentPattern,
    '-hls_playlist_type', 'vod',
    '-y',
    playlistPath,
  ];

  const result = await runFfmpeg(args, 120000);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    throw new Error(`FFMPEG_HLS_FAILED: ${result.stderr}`);
  }

  if (!existsSync(playlistPath)) {
    throw new Error('HLS_PLAYLIST_NOT_CREATED');
  }

  const segments = [];
  try {
    const entries = readdirSync(workDir);
    for (const entry of entries) {
      if (entry.endsWith('.ts') || entry.endsWith('.m4s')) {
        const filePath = join(workDir, entry);
        const stats = statSync(filePath);
        segments.push({ name: entry, path: filePath, size: stats.size });
      }
    }
    segments.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    segments.length = 0;
  }

  return {
    playlistPath,
    workDir,
    segments,
    segmentDuration: opts.segmentDuration,
  };
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
