import {isAbsolute} from 'node:path';
import {realpath,stat} from 'node:fs/promises';
import {HelperError} from './errors.js';

// Excludes playlists, concat, image sequences and other multi-resource demuxers.
export const LOCAL_MEDIA_FORMATS = 'mov,matroska,webm,wav,mp3,flac,aac,aiff,ogg,avi,mxf';
export function validateLocalPath(path: string): void {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || !isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new HelperError('INVALID_PATH', 'An absolute local media file path is required', 400);
  }
}
export async function resolveMediaPath(path: string): Promise<string> {
  validateLocalPath(path);
  try {
    const resolved = await realpath(path);
    if (!(await stat(resolved)).isFile()) throw new HelperError('INVALID_PATH', 'Input must be a regular local file', 400);
    return resolved;
  } catch (error) {
    if (error instanceof HelperError) throw error;
    throw new HelperError('MEDIA_NOT_FOUND', 'Local media file is unavailable', 404);
  }
}
