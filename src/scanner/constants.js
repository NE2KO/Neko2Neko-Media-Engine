export const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.3gp', '.hevc', '.h265']);
export const AUDIO_EXTS = new Set(['.mp3', '.flac', '.opus', '.wav', '.ogg', '.aac', '.m4a', '.wma', '.webm']);
export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg', '.avif']);

export function detectType(ext) {
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}
