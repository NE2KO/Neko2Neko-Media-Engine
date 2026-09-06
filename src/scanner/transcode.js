import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export async function runFfmpeg(inputPath, options = {}) {
  if (!existsSync(inputPath)) {
    throw new Error('FILE_MISSING');
  }

  const outputPath = options.outputPath || `${inputPath}.out`;
  const remux = options.remux || false;
  const faststart = options.faststart || false;

  if (remux) {
    return await runRemux(inputPath, outputPath);
  }

  if (faststart) {
    return await runFaststart(inputPath, outputPath);
  }

  return await runTranscode(inputPath, outputPath, options);
}

async function runRemux(inputPath, outputPath) {
  const args = [
    '-v', 'quiet',
    '-i', inputPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];

  const result = await spawnFfmpeg(args, 120000);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    throw new Error(`FFMPEG_REMUX_FAILED: ${result.stderr}`);
  }

  return { ok: true, outputPath, exitCode: result.exitCode };
}

async function runFaststart(inputPath, outputPath) {
  const args = [
    '-v', 'quiet',
    '-i', inputPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];

  const result = await spawnFfmpeg(args, 120000);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    throw new Error(`FFMPEG_FASTSTART_FAILED: ${result.stderr}`);
  }

  return { ok: true, outputPath, exitCode: result.exitCode };
}

async function runTranscode(inputPath, outputPath, options = {}) {
  const args = [
    '-v', 'quiet',
    '-i', inputPath,
  ];

  if (options.videoCodec) {
    args.push('-c:v', options.videoCodec);
  } else {
    args.push('-c:v', 'libx264');
  }

  if (options.audioCodec) {
    args.push('-c:a', options.audioCodec);
  } else {
    args.push('-c:a', 'aac');
  }

  if (options.videoBitrate) {
    args.push('-b:v', options.videoBitrate);
  }

  if (options.audioBitrate) {
    args.push('-b:a', options.audioBitrate);
  }

  if (options.resolution) {
    args.push('-s', options.resolution);
  }

  if (options.fps) {
    args.push('-r', String(options.fps));
  }

  args.push('-y', outputPath);

  const result = await spawnFfmpeg(args, 600000);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    throw new Error(`FFMPEG_TRANSCODE_FAILED: ${result.stderr}`);
  }

  return { ok: true, outputPath, exitCode: result.exitCode };
}

function spawnFfmpeg(args, timeoutMs = 60000) {
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
