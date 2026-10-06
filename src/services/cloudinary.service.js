import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { v2 as cloudinary } from 'cloudinary';
import { AppError } from '../utils/errors.js';

const LARGE_UPLOAD_THRESHOLD_BYTES = 100 * 1024 * 1024;

function configureCloudinary() {
  if (process.env.CLOUDINARY_URL) {
    return;
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new AppError('Cloudinary credentials are not configured.', 500, 'CLOUDINARY_NOT_CONFIGURED');
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });
}

function uploadLarge(filePath, options) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(filePath, options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function numberConfig(name, fallback) {
  const value = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(value) ? value : fallback;
}

function runCommand(command, args, failureMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      reject(new AppError(failureMessage, 500, 'CLOUDINARY_PREP_FAILED'));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new AppError(failureMessage, 422, 'CLOUDINARY_PREP_FAILED'));
    });
  });
}

async function getVideoDuration(filePath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ], 'Could not inspect video before Cloudinary upload.');

  const duration = Number.parseFloat(stdout);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AppError('Could not determine video duration before upload.', 422, 'CLOUDINARY_PREP_FAILED');
  }
  return duration;
}

function parseAudioKbps(value) {
  const match = String(value || '96k').match(/(\d+)/);
  return match ? Number(match[1]) : 96;
}

async function prepareCloudinaryUploadFile(filePath, jobId, stat) {
  const maxUploadMb = numberConfig('CLOUDINARY_MAX_UPLOAD_MB', 95);
  const maxBytes = maxUploadMb * 1024 * 1024;
  if (stat.size <= maxBytes) {
    return { filePath, bytes: stat.size, optimized: false };
  }

  const duration = await getVideoDuration(filePath);
  const targetBytes = maxBytes * 0.92;
  const totalKbps = Math.max(350, Math.floor((targetBytes * 8) / duration / 1000));
  const audioBitrate = process.env.CLOUDINARY_UPLOAD_AUDIO_BITRATE || '96k';
  const audioKbps = parseAudioKbps(audioBitrate);
  const videoKbps = Math.max(250, totalKbps - audioKbps);
  const maxHeight = Math.max(240, numberConfig('CLOUDINARY_UPLOAD_MAX_HEIGHT', 480));
  const outputPath = path.join(path.dirname(filePath), 'final-cloudinary.mp4');

  console.log('[cloudinary] preparing smaller upload copy', jobId);
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    filePath,
    '-vf',
    `scale=-2:min(${maxHeight}\\,ih)`,
    '-c:v',
    'libx264',
    '-preset',
    process.env.CLOUDINARY_UPLOAD_PRESET || 'ultrafast',
    '-b:v',
    `${videoKbps}k`,
    '-maxrate',
    `${Math.floor(videoKbps * 1.25)}k`,
    '-bufsize',
    `${Math.floor(videoKbps * 2)}k`,
    '-c:a',
    'aac',
    '-b:a',
    audioBitrate,
    '-movflags',
    '+faststart',
    outputPath
  ], 'Could not create smaller video for Cloudinary upload.');

  const outputStat = await fs.stat(outputPath);
  if (outputStat.size > maxBytes) {
    throw new AppError(`Cloudinary upload copy is still too large (${Math.round(outputStat.size / 1024 / 1024)} MB). Lower CLOUDINARY_UPLOAD_MAX_HEIGHT or increase your Cloudinary upload limit.`, 413, 'CLOUDINARY_FILE_TOO_LARGE');
  }

  return {
    filePath: outputPath,
    bytes: outputStat.size,
    optimized: true
  };
}

export async function uploadVideoToCloudinary(filePath, jobId) {
  configureCloudinary();

  try {
    await fs.access(filePath);
  } catch {
    throw new AppError('Final video was not found for upload.', 404, 'FINAL_VIDEO_NOT_FOUND');
  }

  const stat = await fs.stat(filePath);
  const uploadFile = await prepareCloudinaryUploadFile(filePath, jobId, stat);
  const folder = (process.env.CLOUDINARY_FOLDER || 'flow-social-automation').replace(/^\/+|\/+$/g, '');
  const publicId = `${folder}/${jobId}`;
  const options = {
    resource_type: 'video',
    public_id: publicId,
    overwrite: true,
    invalidate: true
  };

  console.log('[cloudinary] upload started', jobId);

  try {
    const result = uploadFile.bytes > LARGE_UPLOAD_THRESHOLD_BYTES
      ? await uploadLarge(uploadFile.filePath, { ...options, chunk_size: 20 * 1024 * 1024 })
      : await cloudinary.uploader.upload(uploadFile.filePath, options);

    console.log('[cloudinary] upload complete', jobId);
    return {
      status: 'uploaded',
      publicId: result.public_id,
      secureUrl: result.secure_url,
      bytes: result.bytes || uploadFile.bytes,
      duration: result.duration ?? null,
      format: result.format || path.extname(uploadFile.filePath).replace('.', ''),
      optimizedForUpload: uploadFile.optimized,
      originalBytes: stat.size,
      uploadedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const message = String(error?.message || '').toLowerCase();
    if (error?.http_code === 401 || message.includes('invalid api key') || message.includes('signature')) {
      throw new AppError('Cloudinary authentication failed. Check cloud name, API key, and API secret.', 502, 'CLOUDINARY_AUTH_FAILED');
    }

    if (error?.http_code === 400 || error?.http_code === 413 || message.includes('file size')) {
      throw new AppError('Cloudinary rejected the video size. Reduce CLOUDINARY_UPLOAD_MAX_HEIGHT or upgrade the Cloudinary upload limit.', 413, 'CLOUDINARY_FILE_TOO_LARGE');
    }

    throw new AppError('Cloudinary upload failed. Check upload limits and network access.', 502, 'CLOUDINARY_UPLOAD_FAILED');
  }
}
