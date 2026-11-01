import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db, get, now } from '../db.js';
import { badRequest } from './errors.js';
import { track } from './social.js';

const execFileAsync = promisify(execFile);

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg']);
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm']);

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'text/plain': 'txt',
};
const ALLOWED_MIME = new Set([...IMAGE_MIME, ...VIDEO_MIME, ...AUDIO_MIME, 'application/pdf', 'application/zip', 'text/plain']);

function kindFor(mime) {
  if (IMAGE_MIME.has(mime)) return 'image';
  if (VIDEO_MIME.has(mime)) return 'video';
  if (AUDIO_MIME.has(mime)) return 'audio';
  return 'file';
}

function maxUploadMb() {
  const row = get("SELECT value FROM app_settings WHERE key = 'max_upload_mb'");
  if (row) {
    try {
      const value = Number(JSON.parse(row.value));
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      /* use environment fallback */
    }
  }
  return config.maxUploadMb;
}

async function tryExec(cmd, args, timeout = 120000) {
  try {
    const out = await execFileAsync(cmd, args, { timeout, maxBuffer: 1024 * 1024 * 32 });
    return { ok: true, stdout: out.stdout, stderr: out.stderr };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function probeMedia(filePath) {
  const res = await tryExec('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json', filePath,
  ], 20000);
  if (!res.ok) return { width: null, height: null, duration: null };
  try {
    const data = JSON.parse(res.stdout);
    const stream = data.streams?.[0] || {};
    const duration = Number(stream.duration || data.format?.duration) || null;
    return { width: stream.width || null, height: stream.height || null, duration };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

export async function saveUpload({ ownerId, buffer, mime, kindHint }) {
  const limitMb = maxUploadMb();
  const maxBytes = limitMb * 1024 * 1024;
  if (!buffer || buffer.length === 0) throw badRequest('Tệp rỗng');
  if (buffer.length > maxBytes) throw badRequest(`Tệp vượt quá ${limitMb}MB`);
  const detected = String(mime || '').toLowerCase();
  if (!ALLOWED_MIME.has(detected)) throw badRequest('Định dạng tệp không được hỗ trợ');
  const kind = kindHint || kindFor(detected);
  const ext = EXT[detected];
  const base = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const originalName = `${base}.${ext}`;
  const originalPath = path.join(config.uploadsDir, originalName);
  fs.writeFileSync(originalPath, buffer);

  let finalName = originalName;
  let finalPath = originalPath;
  let thumbUrl = null;
  let width = null;
  let height = null;
  let duration = null;
  let size = buffer.length;
  let status = 'ready';

  if (kind === 'image') {
    const thumbName = `${base}-thumb.jpg`;
    const thumbPath = path.join(config.uploadsDir, thumbName);
    const thumbRes = await tryExec('ffmpeg', ['-y', '-i', originalPath, '-vf', "scale='min(480,iw)':-2", '-q:v', '4', thumbPath], 30000);
    if (thumbRes.ok) thumbUrl = `/uploads/${thumbName}`;
    if (detected !== 'image/gif') {
      const optimizedName = `${base}-opt.jpg`;
      const optimizedPath = path.join(config.uploadsDir, optimizedName);
      const optRes = await tryExec('ffmpeg', ['-y', '-i', originalPath, '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', optimizedPath], 60000);
      if (optRes.ok) {
        fs.unlinkSync(originalPath);
        finalName = optimizedName;
        finalPath = optimizedPath;
        size = fs.statSync(optimizedPath).size;
        thumbUrl = thumbUrl || `/uploads/${optimizedName}`;
      }
    }
    const info = await probeMedia(finalPath);
    width = info.width;
    height = info.height;
  } else if (kind === 'video') {
    const info = await probeMedia(originalPath);
    width = info.width;
    height = info.height;
    duration = info.duration;
    const thumbName = `${base}-poster.jpg`;
    const thumbPath = path.join(config.uploadsDir, thumbName);
    const thumbRes = await tryExec('ffmpeg', ['-y', '-ss', '0.5', '-i', originalPath, '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", '-q:v', '4', thumbPath], 30000);
    if (thumbRes.ok) thumbUrl = `/uploads/${thumbName}`;
    if (detected !== 'video/mp4' || size > 12 * 1024 * 1024) {
      const webName = `${base}-web.mp4`;
      const webPath = path.join(config.uploadsDir, webName);
      const transcode = await tryExec('ffmpeg', [
        '-y', '-i', originalPath,
        '-vf', "scale='min(1280,iw)':-2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        webPath,
      ], 180000);
      if (transcode.ok) {
        fs.rmSync(originalPath, { force: true });
        finalName = webName;
        finalPath = webPath;
        size = fs.statSync(webPath).size;
        const webInfo = await probeMedia(webPath);
        width = webInfo.width || width;
        height = webInfo.height || height;
        duration = webInfo.duration || duration;
      }
    }
  } else if (kind === 'audio') {
    const info = await probeMedia(originalPath);
    duration = info.duration;
  }

  const mediaId = crypto.randomUUID();
  const url = `/uploads/${finalName}`;
  db.prepare(
    `INSERT INTO media (id, owner_id, kind, filename, mime, size, width, height, duration, url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(mediaId, ownerId || null, kind, finalName, detected, size, width, height, duration, url, now());
  track(ownerId, 'media_upload', 'media', mediaId, { kind, size });
  return { id: mediaId, kind, url, thumb_url: thumbUrl, width, height, duration, size, mime: detected, status };
}

export function mediaLimits() {
  return { max_upload_mb: maxUploadMb(), accept: [...ALLOWED_MIME] };
}
