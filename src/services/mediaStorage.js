import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/errors.js';

const JOB_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export function getDownloadRoot() {
  return path.resolve(process.env.DOWNLOAD_DIR || 'storage/downloads');
}

export async function ensureDownloadRoot() {
  await fs.mkdir(getDownloadRoot(), { recursive: true });
}

export function createJobId() {
  return randomUUID();
}

export function assertSafeJobId(jobId) {
  if (!JOB_ID_PATTERN.test(jobId || '')) {
    throw new AppError('Invalid media job id.', 400, 'INVALID_JOB_ID');
  }
}

export function getJobDir(jobId) {
  assertSafeJobId(jobId);
  return path.join(getDownloadRoot(), jobId);
}

export async function createJobDirectory(jobId) {
  const jobDir = getJobDir(jobId);
  await fs.mkdir(jobDir, { recursive: false });
  return jobDir;
}

export async function writeMetadata(jobId, metadata) {
  const filePath = path.join(getJobDir(jobId), 'metadata.json');
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf8');
}

export async function readMetadata(jobId) {
  try {
    const raw = await fs.readFile(path.join(getJobDir(jobId), 'metadata.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    throw new AppError('Media metadata was not found.', 404, 'MEDIA_NOT_FOUND');
  }
}

export async function findDownloadedVideo(jobId) {
  const jobDir = getJobDir(jobId);
  const entries = await fs.readdir(jobDir);
  const videoName = entries.find((entry) => /^source\.(mp4|m4v|webm|mov|mkv)$/i.test(entry));
  if (!videoName) {
    throw new AppError('Downloaded video was not found.', 404, 'VIDEO_NOT_FOUND');
  }
  return {
    fileName: videoName,
    filePath: path.join(jobDir, videoName)
  };
}

export async function findFinalVideo(jobId) {
  const filePath = path.join(getJobDir(jobId), 'final.mp4');
  try {
    await fs.access(filePath);
    return {
      fileName: 'final.mp4',
      filePath
    };
  } catch {
    throw new AppError('Processed final video was not found.', 404, 'FINAL_VIDEO_NOT_FOUND');
  }
}

export async function findThumbnail(jobId) {
  const jobDir = getJobDir(jobId);
  const entries = await fs.readdir(jobDir);
  const thumbnailName = entries.find((entry) => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(entry));
  if (!thumbnailName) {
    throw new AppError('Thumbnail was not found for this media item.', 404, 'THUMBNAIL_NOT_FOUND');
  }
  return {
    fileName: thumbnailName,
    filePath: path.join(jobDir, thumbnailName)
  };
}

export async function cleanupLocalMediaFiles(jobId) {
  const jobDir = getJobDir(jobId);
  const entries = await fs.readdir(jobDir, { withFileTypes: true });
  const removableFilePattern = /^(source|final|final-cloudinary|thumbnail)\.(mp4|m4v|webm|mov|mkv|jpg|jpeg|png|webp)$/i;

  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(jobDir, entry.name);
    if (entry.isDirectory() && entry.name === 'temp') {
      await fs.rm(fullPath, { recursive: true, force: true });
      return;
    }

    if (entry.isFile() && removableFilePattern.test(entry.name)) {
      await fs.rm(fullPath, { force: true });
    }
  }));
}
