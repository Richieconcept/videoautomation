import path from 'node:path';
import { spawn } from 'node:child_process';
import { validatePublicNetworkTarget } from '../../utils/platformDetector.js';
import { AppError } from '../../utils/errors.js';

const USER_AGENT = 'Mozilla/5.0 social-video-fetcher/1.0';

function ytdlpPath() {
  const configuredPath = process.env.YTDLP_PATH || 'yt-dlp';
  return configuredPath.includes('/') || configuredPath.includes('\\')
    ? path.resolve(configuredPath)
    : configuredPath;
}

function flatPlaylistLimit() {
  const limit = Number.parseInt(process.env.AUTO_SOURCE_FLATPLAYLIST_LIMIT || '3', 10);
  return Math.max(1, Number.isFinite(limit) ? limit : 3);
}

function killProcessTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }
  child.kill('SIGTERM');
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killProcessTree(child);
      reject(new AppError('Source scan timed out while reading this creator profile.', 504, 'SOURCE_SCAN_TIMEOUT'));
    }, 45_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      clearTimeout(timer);
      reject(new AppError('Could not start yt-dlp for source scanning.', 500, 'SOURCE_SCANNER_NOT_FOUND'));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new AppError(stderr || 'yt-dlp could not scan this source.', 422, 'SOURCE_SCAN_FAILED'));
    });
  });
}

function entryUrl(entry, sourceUrl) {
  if (entry.webpage_url) return entry.webpage_url;
  if (entry.url && /^https?:\/\//i.test(entry.url)) return entry.url;
  if (entry.id && sourceUrl.includes('youtube.com')) return `https://www.youtube.com/watch?v=${entry.id}`;
  return entry.url || sourceUrl;
}

function isLikelyVideoUrl(platform, url) {
  if (platform === 'youtube') {
    return /youtube\.com\/watch\?v=/i.test(url) || /youtube\.com\/shorts\//i.test(url) || /youtu\.be\//i.test(url);
  }

  if (platform === 'tiktok') {
    return /tiktok\.com\/@[^/]+\/video\//i.test(url) || /vm\.tiktok\.com\//i.test(url);
  }

  if (platform === 'facebook') {
    return /facebook\.com\/.*\/videos\//i.test(url) || /facebook\.com\/reel\//i.test(url) || /facebook\.com\/watch\/?\?v=/i.test(url);
  }

  return /^https?:\/\//i.test(url);
}

function publishedAt(entry) {
  if (entry.timestamp) {
    return new Date(entry.timestamp * 1000).toISOString();
  }
  if (entry.release_timestamp) {
    return new Date(entry.release_timestamp * 1000).toISOString();
  }
  if (entry.upload_date && /^\d{8}$/.test(entry.upload_date)) {
    const year = entry.upload_date.slice(0, 4);
    const month = entry.upload_date.slice(4, 6);
    const day = entry.upload_date.slice(6, 8);
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`).toISOString();
  }
  return null;
}

export function normalizeSourceEntry(entry, source) {
  const url = entryUrl(entry, source.profileUrl);
  return {
    platform: source.platform,
    creatorId: source.creatorId,
    sourceId: source.id,
    externalPostId: entry.id || url,
    url,
    title: entry.title || '',
    description: entry.description || '',
    duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : null,
    thumbnail: entry.thumbnail || '',
    publishedAt: publishedAt(entry),
    raw: {
      id: entry.id,
      ieKey: entry.ie_key,
      uploader: entry.uploader,
      channel: entry.channel
    }
  };
}

export async function scanSource(source, options = {}) {
  await validatePublicNetworkTarget(source.profileUrl);
  const limit = options.limit || flatPlaylistLimit();
  const stdout = await runYtDlp([
    '--dump-single-json',
    '--flat-playlist',
    '--playlist-end',
    String(limit),
    '--no-warnings',
    '--user-agent',
    USER_AGENT,
    source.profileUrl
  ]);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new AppError('Could not parse source scan results.', 502, 'SOURCE_SCAN_PARSE_FAILED');
  }

  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries
    .filter(Boolean)
    .map((entry) => normalizeSourceEntry(entry, source))
    .filter((entry) => entry.url && /^https?:\/\//i.test(entry.url))
    .filter((entry) => isLikelyVideoUrl(source.platform, entry.url));
}
