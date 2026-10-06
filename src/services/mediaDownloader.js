import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { detectPlatform, parseAndValidateUrl, validatePublicNetworkTarget } from '../utils/platformDetector.js';
import { MediaDownloadError } from '../utils/errors.js';
import { getYtDlpPath } from '../utils/ytdlpPath.js';
import {
  createJobDirectory,
  createJobId,
  findDownloadedVideo,
  getJobDir,
  writeMetadata
} from './mediaStorage.js';

const USER_AGENT = 'Mozilla/5.0 social-video-fetcher/1.0';

function maxDuration() {
  return Number.parseInt(process.env.MAX_VIDEO_DURATION || '600', 10);
}

function maxSizeMb() {
  return Number.parseInt(process.env.MAX_DOWNLOAD_SIZE_MB || '2000', 10);
}

function downloadMaxHeight() {
  const height = Number.parseInt(process.env.DOWNLOAD_MAX_HEIGHT || '720', 10);
  return Math.max(240, Number.isFinite(height) ? height : 720);
}

function ytdlpConcurrentFragments() {
  const fragments = Number.parseInt(process.env.YTDLP_CONCURRENT_FRAGMENTS || '4', 10);
  return Math.max(1, Number.isFinite(fragments) ? fragments : 4);
}

function ytdlpTimeoutMs() {
  const minutes = Number.parseInt(process.env.YTDLP_TIMEOUT_MINUTES || '60', 10);
  return Math.max(5, Number.isFinite(minutes) ? minutes : 60) * 60 * 1000;
}

function ytdlpSocketTimeoutSeconds() {
  const seconds = Number.parseInt(process.env.YTDLP_SOCKET_TIMEOUT_SECONDS || '30', 10);
  return Math.max(10, Number.isFinite(seconds) ? seconds : 30);
}

function ytdlpRetries() {
  const retries = Number.parseInt(process.env.YTDLP_RETRIES || '10', 10);
  return Math.max(1, Number.isFinite(retries) ? retries : 10);
}

function downloadFormatSelector() {
  const maxHeight = downloadMaxHeight();
  return [
    `bv*[height<=${maxHeight}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]`,
    `b[height<=${maxHeight}][ext=mp4]`,
    `bv*[height<=${maxHeight}]+ba`,
    `b[height<=${maxHeight}]`,
    'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]',
    'b[ext=mp4]',
    'bv*+ba',
    'b'
  ].join('/');
}

function runYtDlp(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(getYtDlpPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });

    let stdout = '';
    let stderr = '';

    function killProcessTree() {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        });
        return;
      }
      child.kill('SIGTERM');
    }

    const timer = setTimeout(() => {
      killProcessTree();
      reject(new MediaDownloadError(`Timed out while processing the video after ${Math.round(ytdlpTimeoutMs() / 60000)} minutes. Increase YTDLP_TIMEOUT_MINUTES for very long or slow videos.`, 504, 'YTDLP_TIMEOUT'));
    }, ytdlpTimeoutMs());

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new MediaDownloadError('yt-dlp is not installed or is not available on PATH.', 500, 'YTDLP_NOT_FOUND'));
        return;
      }
      reject(new MediaDownloadError('Could not start yt-dlp.', 500, 'YTDLP_START_FAILED'));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(mapYtDlpFailure(stderr || stdout));
    });
  });
}

function mapYtDlpFailure(output) {
  const lower = output.toLowerCase();

  if (lower.includes('private') || lower.includes('login') || lower.includes('sign in')) {
    return new MediaDownloadError('This media appears to be private or login-required.', 403, 'MEDIA_RESTRICTED');
  }

  if (lower.includes('geo') || lower.includes('not available in your country')) {
    return new MediaDownloadError('This media appears to be geo-restricted.', 403, 'MEDIA_GEO_RESTRICTED');
  }

  if (lower.includes('unavailable') || lower.includes('deleted') || lower.includes('removed')) {
    return new MediaDownloadError('This media is unavailable or may have been removed.', 404, 'MEDIA_UNAVAILABLE');
  }

  if (lower.includes('file is larger than max-filesize')) {
    return new MediaDownloadError('This video is larger than the configured download limit.', 413, 'MEDIA_TOO_LARGE');
  }

  if (lower.includes('requested format is not available') || lower.includes('no video formats found')) {
    return new MediaDownloadError('No downloadable video was found for this URL.', 422, 'NO_DOWNLOADABLE_VIDEO');
  }

  return new MediaDownloadError('yt-dlp could not process this URL. It may be unavailable or restricted.', 422);
}

function pickCaption(platform, info) {
  if (platform === 'tiktok') {
    return info.description || info.title || '';
  }

  if (platform === 'facebook') {
    return info.description || info.title || '';
  }

  return info.title || info.description || '';
}

function publicMetadata(platform, sourceUrl, info) {
  return {
    platform,
    sourceUrl,
    resolvedUrl: info.original_url && info.original_url !== sourceUrl ? info.original_url : undefined,
    title: info.title || '',
    description: info.description || '',
    caption: pickCaption(platform, info),
    uploader: info.uploader || info.channel || info.creator || '',
    uploaderId: info.uploader_id || info.channel_id || '',
    duration: info.duration ?? null,
    width: info.width ?? null,
    height: info.height ?? null,
    thumbnail: info.thumbnail || '',
    uploadDate: info.upload_date || '',
    webpageUrl: info.webpage_url || ''
  };
}

function assertDurationAllowed(metadata, limit = maxDuration()) {
  if (Number.isFinite(limit) && limit > 0 && metadata.duration && metadata.duration > limit) {
    throw new MediaDownloadError(`This video is longer than the configured ${limit} second limit.`, 413, 'MEDIA_TOO_LONG');
  }
}

async function saveThumbnail(jobId, thumbnailUrl) {
  if (!thumbnailUrl) {
    return null;
  }

  try {
    const parsed = parseAndValidateUrl(thumbnailUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const response = await fetch(parsed, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const bytes = Buffer.from(await response.arrayBuffer());
    const fileName = `thumbnail.${extension}`;
    await fs.writeFile(path.join(getJobDir(jobId), fileName), bytes);
    return fileName;
  } catch {
    return null;
  }
}

export { detectPlatform };

export async function fetchMetadata(url, options = {}) {
  const platform = detectPlatform(url);
  await validatePublicNetworkTarget(url);

  console.log('[media] platform detected', platform);
  const { stdout } = await runYtDlp([
    '--dump-single-json',
    '--no-playlist',
    '--skip-download',
    '--no-warnings',
    '--user-agent',
    USER_AGENT,
    url
  ]);

  let info;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new MediaDownloadError('Could not parse metadata from yt-dlp.', 502, 'METADATA_PARSE_FAILED');
  }

  const metadata = publicMetadata(platform, url, info);
  if (options.assertDuration !== false) {
    assertDurationAllowed(metadata, options.maxDurationSeconds ?? maxDuration());
  }
  console.log('[media] metadata fetched');
  return metadata;
}

export async function downloadVideo(url, jobId) {
  const jobDir = getJobDir(jobId);
  const outputTemplate = path.join(jobDir, 'source.%(ext)s');
  const sizeMb = maxSizeMb();

  console.log('[media] download started', jobId);
  await runYtDlp([
    '--no-playlist',
    '--no-overwrites',
    '--user-agent',
    USER_AGENT,
    '--socket-timeout',
    String(ytdlpSocketTimeoutSeconds()),
    '--retries',
    String(ytdlpRetries()),
    '--fragment-retries',
    String(ytdlpRetries()),
    '--concurrent-fragments',
    String(ytdlpConcurrentFragments()),
    '--continue',
    '--max-filesize',
    `${sizeMb}M`,
    '-f',
    downloadFormatSelector(),
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate,
    url
  ]);

  const downloaded = await findDownloadedVideo(jobId);
  console.log('[media] download completed', jobId);
  return downloaded;
}

export async function fetchAndDownload(url, options = {}) {
  const metadata = options.metadata || await fetchMetadata(url, {
    maxDurationSeconds: options.maxDurationSeconds,
    assertDuration: options.assertDuration
  });
  const jobId = createJobId();
  console.log('[media] job created', jobId);
  await createJobDirectory(jobId);

  try {
    const thumbnailFileName = await saveThumbnail(jobId, metadata.thumbnail);
    const downloaded = await downloadVideo(url, jobId);

    const completeMetadata = {
      ...metadata,
      jobId,
      automation: options.automation || metadata.automation || null,
      downloadStatus: 'completed',
      downloadedFileName: downloaded.fileName,
      downloadedFilePath: downloaded.filePath,
      thumbnailFileName
    };

    await writeMetadata(jobId, completeMetadata);
    return completeMetadata;
  } catch (error) {
    console.log('[media] download failed', jobId);
    const failedMetadata = {
      jobId,
      sourceUrl: url,
      downloadStatus: 'failed',
      error: error.message
    };
    await writeMetadata(jobId, failedMetadata).catch(() => {});
    throw error;
  }
}
