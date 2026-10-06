import { fetchAndDownload, fetchMetadata } from '../mediaDownloader.js';
import { processVideo } from '../videoEditor.js';
import { processForPublishing } from '../publishing.service.js';
import { readState, updateState, newId, addCreator } from './automationStore.js';
import { scanSource } from './ytDlpSource.js';
import { AppError } from '../../utils/errors.js';

let scheduler = null;
let cycleRunning = false;
let processorRunning = false;

function now() {
  return new Date().toISOString();
}

function minutesConfig(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Math.max(1, Number.isFinite(value) ? value : fallback);
}

function numberConfig(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function maxAutoDuration() {
  return numberConfig('MAX_AUTO_VIDEO_DURATION_SECONDS', 300);
}

function minAutoDuration() {
  return numberConfig('MIN_AUTO_VIDEO_DURATION_SECONDS', 8);
}

function trimLongAutoVideos() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.AUTO_TRIM_LONG_VIDEOS || 'true').toLowerCase());
}

function maxPostsPerDay() {
  return numberConfig('MAX_POSTS_PER_DAY', 10);
}

function bootstrapMaxAgeMs() {
  return numberConfig('BOOTSTRAP_MAX_AGE_HOURS', 48) * 60 * 60 * 1000;
}

function watchMaxAgeMs() {
  return numberConfig('MAX_AUTO_SOURCE_AGE_HOURS', 24) * 60 * 60 * 1000;
}

function bootstrapPerCreator() {
  return numberConfig('AUTO_BOOTSTRAP_PER_CREATOR', 2);
}

function normalizeUrl(url = '') {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'si'].forEach((param) => parsed.searchParams.delete(param));
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url).trim();
  }
}

function simpleFingerprint({ creatorId, title = '', duration = null }) {
  const words = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 10)
    .join('-');
  const bucket = duration ? Math.round(Number(duration) / 5) * 5 : 'unknown';
  return `${creatorId}:${bucket}:${words}`;
}

export function shouldAcceptCandidate(candidate, state, options = {}) {
  const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : null;
  const maxAge = options.bootstrap ? bootstrapMaxAgeMs() : watchMaxAgeMs();
  const ageKnown = Number.isFinite(publishedAt);
  const normalizedUrl = normalizeUrl(candidate.url);
  const fingerprint = simpleFingerprint(candidate);
  const duplicate = state.posts.some((post) => {
    return post.normalizedUrl === normalizedUrl
      || (post.platform === candidate.platform && post.externalPostId === candidate.externalPostId)
      || (post.creatorId === candidate.creatorId && post.contentFingerprint === fingerprint && fingerprint.split(':').at(-1));
  });

  if (duplicate) {
    return { accepted: false, status: 'duplicate', reason: 'This video was already discovered or closely matches an existing post.' };
  }

  if (ageKnown && Date.now() - publishedAt > maxAge) {
    return { accepted: false, status: 'too_old', reason: 'Video is outside the configured source age window.' };
  }

  if (candidate.duration && candidate.duration < minAutoDuration()) {
    return { accepted: false, status: 'too_short', reason: 'Video is shorter than the automation minimum duration.' };
  }

  if (!trimLongAutoVideos() && candidate.duration && candidate.duration > maxAutoDuration()) {
    return { accepted: false, status: 'too_long', reason: 'Video is longer than the automation maximum duration.' };
  }

  if ((state.counters?.queuedToday || 0) >= maxPostsPerDay()) {
    return { accepted: false, status: 'daily_limit', reason: 'The daily automation limit has already been reached.' };
  }

  return { accepted: true, normalizedUrl, contentFingerprint: fingerprint };
}

function creatorPriorityValue(priority) {
  return priority === 'high' ? 50 : 30;
}

async function enrichCandidate(candidate) {
  try {
    const metadata = await fetchMetadata(candidate.url, { assertDuration: false });
    return {
      ...candidate,
      title: candidate.title || metadata.title || '',
      description: candidate.description || metadata.description || '',
      duration: candidate.duration || metadata.duration || null,
      thumbnail: candidate.thumbnail || metadata.thumbnail || '',
      metadata
    };
  } catch (error) {
    return {
      ...candidate,
      metadataError: error.message
    };
  }
}

async function recordRejected(candidate, status, reason) {
  await updateState((state) => {
    const normalizedUrl = normalizeUrl(candidate.url);
    const fingerprint = simpleFingerprint(candidate);
    const alreadyRecorded = state.posts.some((post) => {
      return post.normalizedUrl === normalizedUrl
        || (post.platform === candidate.platform && post.externalPostId === candidate.externalPostId)
        || (post.creatorId === candidate.creatorId && post.contentFingerprint === fingerprint && fingerprint.split(':').at(-1));
    });

    if (alreadyRecorded) {
      if (status === 'duplicate') {
        state.counters.duplicatesSkippedToday += 1;
      }
      return state;
    }

    state.posts.push({
      id: newId('post'),
      creatorId: candidate.creatorId,
      sourceId: candidate.sourceId,
      platform: candidate.platform,
      externalPostId: candidate.externalPostId,
      url: candidate.url,
      normalizedUrl,
      title: candidate.title || '',
      duration: candidate.duration || null,
      publishedAt: candidate.publishedAt || null,
      status,
      reason,
      contentFingerprint: fingerprint,
      discoveredAt: now()
    });
    if (status === 'duplicate') {
      state.counters.duplicatesSkippedToday += 1;
    }
    return state;
  });
}

async function queueCandidate(candidate, decision, creator) {
  await updateState((state) => {
    const postId = newId('post');
    const jobId = newId('autojob');
    state.posts.push({
      id: postId,
      creatorId: candidate.creatorId,
      sourceId: candidate.sourceId,
      platform: candidate.platform,
      externalPostId: candidate.externalPostId,
      url: candidate.url,
      normalizedUrl: decision.normalizedUrl,
      title: candidate.title || '',
      description: candidate.description || '',
      duration: candidate.duration || null,
      thumbnail: candidate.thumbnail || '',
      publishedAt: candidate.publishedAt || null,
      status: 'queued',
      reason: null,
      contentFingerprint: decision.contentFingerprint,
      discoveredAt: now()
    });
    state.jobs.push({
      id: jobId,
      postId,
      creatorId: candidate.creatorId,
      priority: creatorPriorityValue(creator.priority),
      status: 'queued',
      url: candidate.url,
      mediaJobId: null,
      error: null,
      createdAt: now(),
      updatedAt: now()
    });
    state.counters.discoveredToday += 1;
    state.counters.queuedToday += 1;
    return state;
  });
}

async function checkSource(source, creator, options) {
  if (!source.enabled || !creator.enabled) {
    return { sourceId: source.id, platform: source.platform, skipped: true, reason: 'disabled' };
  }

  try {
    await updateState((state) => {
      const target = state.sources.find((item) => item.id === source.id);
      if (target) {
        target.lastCheckStartedAt = now();
        target.updatedAt = now();
      }
      return state;
    });

    const scanned = await scanSource(source);
    let accepted = 0;
    let rejected = 0;
    const sourceCap = options.bootstrap ? bootstrapPerCreator() : Number.POSITIVE_INFINITY;

    for (const rawCandidate of scanned) {
      if (options.bootstrap && options.creatorQueuedCounts.get(creator.id) >= sourceCap) {
        break;
      }

      const candidate = await enrichCandidate(rawCandidate);
      if (candidate.metadataError) {
        await recordRejected(candidate, 'review', candidate.metadataError);
        rejected += 1;
        continue;
      }

      const state = await readState();
      const decision = shouldAcceptCandidate(candidate, state, options);
      if (!decision.accepted) {
        await recordRejected(candidate, decision.status, decision.reason);
        rejected += 1;
        continue;
      }

      await queueCandidate(candidate, decision, creator);
      options.creatorQueuedCounts.set(creator.id, (options.creatorQueuedCounts.get(creator.id) || 0) + 1);
      accepted += 1;
    }

    await updateState((state) => {
      const target = state.sources.find((item) => item.id === source.id);
      if (target) {
        target.lastCheckedAt = now();
        target.lastError = null;
        target.lastSeenPostId = scanned[0]?.externalPostId || target.lastSeenPostId;
        target.lastSeenPublishedAt = scanned[0]?.publishedAt || target.lastSeenPublishedAt;
        target.updatedAt = now();
      }
      return state;
    });

    return { sourceId: source.id, platform: source.platform, accepted, rejected };
  } catch (error) {
    await updateState((state) => {
      const target = state.sources.find((item) => item.id === source.id);
      if (target) {
        target.lastCheckedAt = now();
        target.lastError = error.message;
        target.updatedAt = now();
      }
      state.counters.failedToday += 1;
      return state;
    });
    return { sourceId: source.id, platform: source.platform, accepted: 0, rejected: 0, error: error.message };
  }
}

export async function runSourceCycle(options = {}) {
  if (cycleRunning) {
    return { success: true, running: true, message: 'A source check is already running.' };
  }

  cycleRunning = true;
  try {
    const state = await readState();
    const bootstrap = Boolean(options.bootstrap || !state.settings.bootstrapCompleted);
    const intervalMs = minutesConfig('SOURCE_CHECK_INTERVAL_MINUTES', 15) * 60 * 1000;
    await updateState((latest) => {
      latest.settings.lastCycleAt = now();
      latest.settings.nextCycleAt = new Date(Date.now() + intervalMs).toISOString();
      return latest;
    });

    const creatorQueuedCounts = new Map(state.creators.map((creator) => [creator.id, 0]));
    const selectedCreators = state.creators.filter((creator) => !options.creatorId || creator.id === options.creatorId);
    const results = [];

    for (const creator of selectedCreators) {
      const sources = state.sources.filter((source) => source.creatorId === creator.id);
      for (const source of sources) {
        results.push(await checkSource(source, creator, { bootstrap, creatorQueuedCounts }));
      }
    }

    await updateState((latest) => {
      latest.settings.nextCycleAt = new Date(Date.now() + intervalMs).toISOString();
      if (bootstrap && !options.creatorId) {
        latest.settings.bootstrapCompleted = true;
      }
      return latest;
    });

    processQueuedAutoJobs().catch((error) => {
      console.error('[automation] processor failed', error);
    });

    return { success: true, bootstrap, results };
  } finally {
    cycleRunning = false;
  }
}

function autoPublishPlatforms(metadata) {
  const platforms = ['facebook'];
  const duration = metadata.finalDuration || metadata.sourceDuration || metadata.duration || 0;
  const isPortrait = metadata.output?.height > metadata.output?.width || metadata.height > metadata.width;

  if (duration <= 600) {
    platforms.push('tiktok');
  }

  if (duration <= 180 && isPortrait) {
    platforms.push('youtube');
  }

  return platforms;
}

async function updateJob(jobId, updates) {
  await updateState((state) => {
    const job = state.jobs.find((item) => item.id === jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: now() });
    }
    if (updates.postStatus) {
      const post = state.posts.find((item) => item.id === job?.postId);
      if (post) {
        post.status = updates.postStatus;
        post.reason = updates.error || post.reason;
      }
    }
    return state;
  });
}

export async function processQueuedAutoJobs() {
  if (processorRunning) return { success: true, running: true };
  processorRunning = true;

  try {
    while (true) {
      const state = await readState();
      const job = [...state.jobs]
        .filter((item) => item.status === 'queued')
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];

      if (!job) {
        return { success: true, processed: false };
      }

      const post = state.posts.find((item) => item.id === job.postId);
      if (!post) {
        await updateJob(job.id, { status: 'failed', error: 'Source post record is missing.', postStatus: 'failed' });
        continue;
      }

      try {
        await updateJob(job.id, { status: 'downloading', postStatus: 'downloading' });
        const metadata = await fetchAndDownload(job.url, {
          assertDuration: false,
          maxDurationSeconds: maxAutoDuration(),
          automation: {
            creatorId: job.creatorId,
            sourcePostId: post.id,
            sourceId: post.sourceId,
            priority: job.priority,
            source: 'auto'
          }
        });

        if (metadata.duration && metadata.duration < minAutoDuration()) {
          await updateJob(job.id, {
            status: 'too_short',
            mediaJobId: metadata.jobId,
            error: 'Downloaded video duration is outside automation limits.',
            postStatus: 'too_short'
          });
          continue;
        }

        if (!trimLongAutoVideos() && metadata.duration && metadata.duration > maxAutoDuration()) {
          await updateJob(job.id, {
            status: 'too_long',
            mediaJobId: metadata.jobId,
            error: 'Downloaded video duration is outside automation limits.',
            postStatus: 'too_long'
          });
          continue;
        }

        await updateJob(job.id, { status: 'processing', mediaJobId: metadata.jobId, postStatus: 'processing' });
        const processed = await processVideo(metadata.jobId, {
          sourceDurationLimitSeconds: trimLongAutoVideos() ? maxAutoDuration() : 0
        });
        await updateJob(job.id, { status: 'publishing', postStatus: 'publishing' });
        await processForPublishing(metadata.jobId, {
          platforms: autoPublishPlatforms(processed),
          mode: process.env.AUTO_POST_MODE || 'addToQueue'
        });
        await updateJob(job.id, { status: 'completed', postStatus: 'completed' });
        await updateState((latest) => {
          latest.counters.processedToday += 1;
          latest.counters.publishedToday += 1;
          return latest;
        });
      } catch (error) {
        await updateJob(job.id, { status: 'failed', error: error.message, postStatus: 'failed' });
        await updateState((latest) => {
          latest.counters.failedToday += 1;
          return latest;
        });
      }
    }
  } finally {
    processorRunning = false;
  }
}

export async function getAutomationSummary() {
  const state = await readState();
  const creators = state.creators.map((creator) => ({
    ...creator,
    sources: state.sources.filter((source) => source.creatorId === creator.id),
    queuedToday: state.posts.filter((post) => post.creatorId === creator.id && post.status === 'queued').length
  }));

  return {
    success: true,
    settings: state.settings,
    counters: state.counters,
    running: { cycleRunning, processorRunning },
    creators,
    recentPosts: [...state.posts].slice(-25).reverse(),
    recentJobs: [...state.jobs].slice(-25).reverse()
  };
}

export async function setAutomationEnabled(enabled) {
  await updateState((state) => {
    state.settings.autoSourcingEnabled = Boolean(enabled);
    state.settings.updatedAt = now();
    return state;
  });

  if (enabled) {
    runSourceCycle().catch((error) => console.error('[automation] startup cycle failed', error));
  }

  return getAutomationSummary();
}

export async function createAutomationCreator(input) {
  if (!input?.name) {
    throw new AppError('Creator name is required.', 400, 'CREATOR_NAME_REQUIRED');
  }
  await addCreator(input);
  return getAutomationSummary();
}

export async function startSourceWatcherScheduler() {
  if (scheduler) return;
  const intervalMs = minutesConfig('SOURCE_CHECK_INTERVAL_MINUTES', 15) * 60 * 1000;

  scheduler = setInterval(async () => {
    const state = await readState();
    if (!state.settings.autoSourcingEnabled) return;
    await runSourceCycle();
  }, intervalMs);

  const state = await readState();
  if (state.settings.autoSourcingEnabled) {
    runSourceCycle().catch((error) => console.error('[automation] initial cycle failed', error));
  }
}
