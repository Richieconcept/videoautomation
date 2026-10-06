import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from '../utils/errors.js';
import {
  findDownloadedVideo,
  getJobDir,
  readMetadata,
  writeMetadata
} from './mediaStorage.js';

const activeJobs = new Set();

function numberConfig(name, fallback) {
  const value = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(value) ? value : fallback;
}

function booleanConfig(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function brandVideoPath() {
  return path.resolve(process.env.BRAND_VIDEO_PATH || 'assets/branding/9ja-trending-tv.mp4');
}

function logoPath() {
  return path.resolve(process.env.LOGO_PATH || 'assets/branding/logo.png');
}

function reactionVideoPath() {
  return path.resolve(process.env.REACTION_VIDEO_PATH || 'assets/branding/reaction.mp4');
}

function outputFps() {
  return numberConfig('VIDEO_OUTPUT_FPS', 24);
}

function processingTimeoutMs() {
  return Math.max(10, numberConfig('PROCESSING_TIMEOUT_MINUTES', 120)) * 60 * 1000;
}

function ffmpegPreset() {
  return process.env.FFMPEG_PRESET || 'ultrafast';
}

function videoCrf() {
  return String(numberConfig('VIDEO_CRF', 26));
}

function audioBitrate() {
  return process.env.AUDIO_BITRATE || '128k';
}

function outputMaxHeight() {
  return Math.max(240, numberConfig('OUTPUT_MAX_HEIGHT', 720));
}

function evenDimension(value, fallback) {
  const parsed = Math.round(Number(value) || fallback);
  return parsed % 2 === 0 ? parsed : parsed - 1;
}

function outputDimensions(sourceInfo, brandInfo) {
  const sourceWidth = evenDimension(sourceInfo.width, brandInfo.width || 720);
  const sourceHeight = evenDimension(sourceInfo.height, brandInfo.height || 1280);
  const maxHeight = outputMaxHeight();

  if (sourceHeight <= maxHeight) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const scale = maxHeight / sourceHeight;
  return {
    width: evenDimension(sourceWidth * scale, sourceWidth),
    height: evenDimension(maxHeight, maxHeight)
  };
}

function overlayConfig(sourceInfo = null) {
  const isLandscape = sourceInfo?.width > sourceInfo?.height;
  return {
    logoEnabled: booleanConfig('LOGO_ENABLED', true),
    logoWidthPercent: numberConfig('LOGO_WIDTH_PERCENT', 16),
    logoMarginX: numberConfig('LOGO_MARGIN_X', 24),
    logoMarginY: numberConfig('LOGO_MARGIN_Y', 24),
    reactionEnabled: booleanConfig('REACTION_ENABLED', true),
    reactionWidthPercent: isLandscape
      ? numberConfig('REACTION_LANDSCAPE_WIDTH_PERCENT', 25)
      : numberConfig('REACTION_WIDTH_PERCENT', 45),
    reactionMarginX: numberConfig('REACTION_MARGIN_X', 24),
    reactionMarginY: numberConfig('REACTION_MARGIN_Y', 24),
    reactionMuted: booleanConfig('REACTION_MUTED', true),
    logoPosition: 'top-left',
    reactionPosition: 'bottom-left'
  };
}

function runCommand(command, args, failureMessage, timeout = processingTimeoutMs()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new AppError(`Video processing timed out after ${Math.round(timeout / 60000)} minutes. Increase PROCESSING_TIMEOUT_MINUTES for very long videos.`, 504, 'VIDEO_PROCESSING_TIMEOUT'));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      const code = error.code === 'ENOENT' ? 'PROCESSOR_NOT_FOUND' : 'PROCESSOR_START_FAILED';
      reject(new AppError(failureMessage, 500, code));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new AppError(failureMessage, 422, 'VIDEO_PROCESSING_FAILED'));
    });
  });
}

export function calculateBrandInsertionPoints(
  sourceDuration,
  firstInsert = 10,
  repeatInterval = 60,
  minimumSourceDuration = 20,
  minimumRemainingContent = 15
) {
  if (!Number.isFinite(sourceDuration) || sourceDuration < minimumSourceDuration || sourceDuration <= firstInsert) {
    return [];
  }

  const points = [firstInsert];
  let nextPoint = firstInsert + repeatInterval;

  while (nextPoint < sourceDuration) {
    const remaining = sourceDuration - nextPoint;
    if (remaining >= minimumRemainingContent) {
      points.push(nextPoint);
    }
    nextPoint += repeatInterval;
  }

  return points;
}

export function buildOutroOnlyTimeline(sourceDuration, brandDuration) {
  return [
    { type: 'source', start: 0, duration: sourceDuration },
    { type: 'brand', start: 0, duration: brandDuration, outro: true }
  ].filter((segment) => segment.duration > 0.05);
}

export async function getVideoInfo(filePath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ], 'Could not read video information with ffprobe.', 90_000);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new AppError('ffprobe returned unreadable video information.', 422, 'FFPROBE_PARSE_FAILED');
  }

  const videoStream = data.streams?.find((stream) => stream.codec_type === 'video');
  if (!videoStream) {
    throw new AppError('This file does not contain a usable video stream.', 422, 'NO_VIDEO_STREAM');
  }

  const audioStream = data.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number.parseFloat(data.format?.duration || videoStream.duration || '0');
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AppError('Could not determine video duration.', 422, 'INVALID_VIDEO_DURATION');
  }

  return {
    duration,
    width: Number(videoStream.width),
    height: Number(videoStream.height),
    hasAudio: Boolean(audioStream),
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream?.codec_name || null
  };
}

async function getImageInfo(filePath, missingMessage, invalidMessage) {
  try {
    await fs.access(filePath);
  } catch {
    throw new AppError(missingMessage, 500, 'OVERLAY_ASSET_MISSING');
  }

  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    filePath
  ], invalidMessage, 90_000);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new AppError(invalidMessage, 422, 'OVERLAY_ASSET_INVALID');
  }

  const imageStream = data.streams?.find((stream) => stream.codec_type === 'video');
  if (!imageStream) {
    throw new AppError(invalidMessage, 422, 'OVERLAY_ASSET_INVALID');
  }

  return {
    width: Number(imageStream.width),
    height: Number(imageStream.height),
    codec: imageStream.codec_name,
    pixelFormat: imageStream.pix_fmt || ''
  };
}

function segmentVideoFilter(width, height, fps) {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p'
  ].join(',');
}

function buildOverlayFilter({
  baseLabel,
  logoIndex,
  reactionIndex,
  width,
  duration,
  fps,
  config
}) {
  const filters = [];
  let currentLabel = baseLabel;

  if (config.reactionEnabled && reactionIndex !== null) {
    const reactionWidth = Math.max(2, evenDimension(width * (config.reactionWidthPercent / 100), 240));
    filters.push(
      `[${reactionIndex}:v]trim=start=0:duration=${duration},setpts=PTS-STARTPTS,scale=${reactionWidth}:-2,fps=${fps},format=yuva420p[reaction]`
    );
    filters.push(
      `[${currentLabel}][reaction]overlay=${config.reactionMarginX}:main_h-overlay_h-${config.reactionMarginY}:shortest=1[withreaction]`
    );
    currentLabel = 'withreaction';
  }

  if (config.logoEnabled && logoIndex !== null) {
    const logoWidth = Math.max(2, evenDimension(width * (config.logoWidthPercent / 100), 120));
    filters.push(`[${logoIndex}:v]trim=start=0:duration=${duration},setpts=PTS-STARTPTS,scale=${logoWidth}:-1,format=rgba[logo]`);
    filters.push(`[${currentLabel}][logo]overlay=${config.logoMarginX}:${config.logoMarginY}:shortest=1[vout]`);
    currentLabel = 'vout';
  }

  return {
    filters,
    outputLabel: currentLabel
  };
}

async function normalizeSegment({
  inputPath,
  outputPath,
  start,
  duration,
  hasAudio,
  width,
  height,
  fps,
  overlays = null,
  sourceTimelineStart = 0
}) {
  const trimStart = Number(start || 0).toFixed(3);
  const trimDuration = Number(duration).toFixed(3);
  const args = ['-y', '-i', inputPath];
  let logoIndex = null;
  let reactionIndex = null;
  let silentAudioIndex = null;

  if (overlays?.config.logoEnabled) {
    logoIndex = 1;
    args.push('-loop', '1', '-i', overlays.logoPath);
  }

  if (overlays?.config.reactionEnabled) {
    reactionIndex = 1 + (logoIndex === null ? 0 : 1);
    const reactionOffset = overlays.reactionInfo.duration > 0
      ? (sourceTimelineStart % overlays.reactionInfo.duration).toFixed(3)
      : '0.000';
    args.push('-stream_loop', '-1', '-ss', reactionOffset, '-i', overlays.reactionPath);
  }

  if (!hasAudio) {
    silentAudioIndex = 1 + (logoIndex === null ? 0 : 1) + (reactionIndex === null ? 0 : 1);
    args.push('-f', 'lavfi', '-t', trimDuration, '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }

  const videoFilter = `[0:v]trim=start=${trimStart}:duration=${trimDuration},setpts=PTS-STARTPTS,${segmentVideoFilter(width, height, fps)}[v]`;
  const audioFilter = hasAudio
    ? `[0:a:0]atrim=start=${trimStart}:duration=${trimDuration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a]`
    : `[${silentAudioIndex}:a:0]asetpts=PTS-STARTPTS[a]`;

  const filters = [videoFilter];
  let videoOutputLabel = 'v';

  if (overlays) {
    const overlayFilter = buildOverlayFilter({
      baseLabel: 'v',
      logoIndex,
      reactionIndex,
      width,
      duration: trimDuration,
      fps,
      config: overlays.config
    });
    filters.push(...overlayFilter.filters);
    videoOutputLabel = overlayFilter.outputLabel;
  }

  filters.push(audioFilter);

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${videoOutputLabel}]`);
  args.push('-map', '[a]');

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    ffmpegPreset(),
    '-crf',
    videoCrf(),
    '-c:a',
    'aac',
    '-b:a',
    audioBitrate(),
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-shortest',
    outputPath
  );

  await runCommand('ffmpeg', args, 'FFmpeg failed while preparing a video segment.');
}

function buildTimeline(sourceDuration, insertionPoints, brandDuration) {
  const timeline = [];
  let cursor = 0;

  insertionPoints.forEach((point) => {
    if (point > cursor) {
      timeline.push({ type: 'source', start: cursor, duration: point - cursor });
    }
    timeline.push({ type: 'brand', start: 0, duration: brandDuration });
    cursor = point;
  });

  if (sourceDuration > cursor) {
    timeline.push({ type: 'source', start: cursor, duration: sourceDuration - cursor });
  }

  timeline.push({ type: 'brand', start: 0, duration: brandDuration, outro: true });
  return timeline.filter((segment) => segment.duration > 0.05);
}

async function concatSegments(segmentPaths, finalPath, listPath) {
  const listText = segmentPaths
    .map((segmentPath) => `file '${segmentPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listPath, listText, 'utf8');

  await runCommand('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    finalPath
  ], 'FFmpeg failed while combining the processed segments.');
}

async function prepareOverlayAssets(config) {
  const overlayAssets = {
    config,
    logoPath: logoPath(),
    reactionPath: reactionVideoPath(),
    logoInfo: null,
    reactionInfo: null
  };

  if (config.logoEnabled) {
    overlayAssets.logoInfo = await getImageInfo(
      overlayAssets.logoPath,
      'Brand logo asset not found.',
      'Brand logo asset is not a valid readable image.'
    );
  }

  if (config.reactionEnabled) {
    try {
      await fs.access(overlayAssets.reactionPath);
    } catch {
      throw new AppError('Reaction video asset not found.', 500, 'REACTION_VIDEO_MISSING');
    }
    overlayAssets.reactionInfo = await getVideoInfo(overlayAssets.reactionPath);
  }

  return overlayAssets;
}

export async function processVideo(jobId, options = {}) {
  if (activeJobs.has(jobId)) {
    throw new AppError('This video is already being processed.', 409, 'PROCESSING_ALREADY_RUNNING');
  }

  activeJobs.add(jobId);

  try {
    console.log('[media] processing started', jobId);
    const source = await findDownloadedVideo(jobId);
    const metadata = await readMetadata(jobId);
    const brandPath = brandVideoPath();

    try {
      await fs.access(brandPath);
    } catch {
      throw new AppError('Brand video file is missing.', 500, 'BRAND_VIDEO_MISSING');
    }

    const [sourceInfo, brandInfo] = await Promise.all([
      getVideoInfo(source.filePath),
      getVideoInfo(brandPath)
    ]);

    const jobDir = getJobDir(jobId);
    const tempDir = path.join(jobDir, 'temp');
    const finalPath = path.join(jobDir, 'final.mp4');
    const tempFinalPath = path.join(jobDir, 'final.tmp.mp4');
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
    await fs.rm(tempFinalPath, { force: true });

    const sourceDurationLimit = Number(options.sourceDurationLimitSeconds || 0);
    const limitedSourceDuration = sourceDurationLimit > 0
      ? Math.min(sourceInfo.duration, sourceDurationLimit)
      : sourceInfo.duration;
    const sourceInfoForTimeline = {
      ...sourceInfo,
      duration: limitedSourceDuration
    };
    const sourceTrimmed = limitedSourceDuration < sourceInfo.duration;

    const { width, height } = outputDimensions(sourceInfo, brandInfo);
    const fps = outputFps();
    const overlays = await prepareOverlayAssets(overlayConfig(sourceInfo));
    const timeline = buildOutroOnlyTimeline(sourceInfoForTimeline.duration, brandInfo.duration);
    const segmentPaths = [];

    for (let index = 0; index < timeline.length; index += 1) {
      const segment = timeline[index];
      const inputPath = segment.type === 'source' ? source.filePath : brandPath;
      const info = segment.type === 'source' ? sourceInfoForTimeline : brandInfo;
      const outputPath = path.join(tempDir, `segment-${String(index).padStart(3, '0')}.mp4`);
      await normalizeSegment({
        inputPath,
        outputPath,
        start: segment.start,
        duration: segment.duration,
        hasAudio: info.hasAudio,
        width,
        height,
        fps,
        overlays: segment.type === 'source' ? overlays : null,
        sourceTimelineStart: segment.type === 'source' ? segment.start : 0
      });
      segmentPaths.push(outputPath);
    }

    await concatSegments(segmentPaths, tempFinalPath, path.join(tempDir, 'concat.txt'));
    await fs.rename(tempFinalPath, finalPath);
    await fs.rm(tempDir, { recursive: true, force: true });

    const finalInfo = await getVideoInfo(finalPath);
    const updatedMetadata = {
      ...metadata,
      processingStatus: 'completed',
      processedAt: new Date().toISOString(),
      cloudinary: null,
      finalFileName: 'final.mp4',
      finalFilePath: finalPath,
      sourceDuration: sourceInfo.duration,
      renderedSourceDuration: sourceInfoForTimeline.duration,
      sourceTrimmed,
      sourceTrimLimitSeconds: sourceTrimmed ? sourceDurationLimit : null,
      brandDuration: brandInfo.duration,
      brandInsertionPoints: [],
      outroEnabled: true,
      finalDuration: finalInfo.duration,
      output: {
        width,
        height,
        fps,
        videoCodec: 'h264',
        audioCodec: 'aac',
        audioSampleRate: 48000
      },
      overlays: {
        logo: {
          enabled: overlays.config.logoEnabled,
          position: overlays.config.logoPosition,
          widthPercent: overlays.config.logoWidthPercent,
          marginX: overlays.config.logoMarginX,
          marginY: overlays.config.logoMarginY,
          asset: overlays.config.logoEnabled ? path.basename(overlays.logoPath) : null
        },
        reaction: {
          enabled: overlays.config.reactionEnabled,
          position: overlays.config.reactionPosition,
          widthPercent: overlays.config.reactionWidthPercent,
          marginX: overlays.config.reactionMarginX,
          marginY: overlays.config.reactionMarginY,
          muted: overlays.config.reactionMuted,
          asset: overlays.config.reactionEnabled ? path.basename(overlays.reactionPath) : null,
          looped: overlays.config.reactionEnabled,
          timing: 'loops continuously for the full source-video section'
        }
      }
    };

    await writeMetadata(jobId, updatedMetadata);
    console.log('[media] processing completed', jobId);
    return updatedMetadata;
  } catch (error) {
    console.log('[media] processing failed', jobId);
    try {
      const metadata = await readMetadata(jobId);
      await writeMetadata(jobId, {
        ...metadata,
        processingStatus: 'failed',
        processingError: error.message
      });
    } catch {
      // Keep the original error if metadata cannot be updated.
    }
    throw error;
  } finally {
    activeJobs.delete(jobId);
  }
}
