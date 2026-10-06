import { AppError } from '../utils/errors.js';

const BUFFER_ENDPOINT = 'https://api.buffer.com';
const PLATFORMS = ['facebook', 'tiktok', 'youtube'];

function boolConfig(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function bufferKey() {
  if (!process.env.BUFFER_API_KEY) {
    throw new AppError('Buffer API key is not configured.', 500, 'BUFFER_NOT_CONFIGURED');
  }
  return process.env.BUFFER_API_KEY;
}

function channelIdFor(platform) {
  const key = {
    facebook: 'BUFFER_FACEBOOK_CHANNEL_ID',
    tiktok: 'BUFFER_TIKTOK_CHANNEL_ID',
    youtube: 'BUFFER_YOUTUBE_CHANNEL_ID'
  }[platform];
  const value = process.env[key];
  if (!value) {
    throw new AppError(`Buffer ${platform} channel ID is not configured.`, 500, 'BUFFER_CHANNEL_MISSING');
  }
  return value;
}

function normalizeMode(mode) {
  const selected = mode || process.env.BUFFER_POST_MODE || process.env.BUFFER_DEFAULT_MODE || 'shareNow';
  const allowed = new Set(['addToQueue', 'shareNow', 'shareNext', 'draft']);
  if (!allowed.has(selected)) {
    return 'shareNow';
  }
  return selected;
}

function metadataFor(platform, payload) {
  if (platform === 'facebook') {
    const configuredType = process.env.BUFFER_FACEBOOK_POST_TYPE || 'post';
    const type = configuredType === 'auto' ? 'post' : configuredType;
    return { facebook: { type } };
  }

  if (platform === 'tiktok') {
    return {
      tiktok: {
        isAiGenerated: boolConfig('BUFFER_DISCLOSE_AI_GENERATED', true)
      }
    };
  }

  if (platform === 'youtube') {
    return {
      youtube: {
        title: payload.youtubeTitle,
        categoryId: process.env.BUFFER_YOUTUBE_CATEGORY_ID || '22',
        privacy: process.env.BUFFER_YOUTUBE_PRIVACY || 'public',
        madeForKids: boolConfig('BUFFER_YOUTUBE_MADE_FOR_KIDS', false),
        isAiGenerated: boolConfig('BUFFER_DISCLOSE_AI_GENERATED', true)
      }
    };
  }

  return undefined;
}

async function bufferGraphql(query, variables) {
  const response = await fetch(BUFFER_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bufferKey()}`
    },
    body: JSON.stringify({ query, variables })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError('Buffer returned an unreadable response.', 502, 'BUFFER_BAD_RESPONSE');
  }

  if (!response.ok || data.errors?.length) {
    throw new AppError('Buffer API request failed. Check credentials and channel access.', 502, 'BUFFER_API_FAILED');
  }

  return data;
}

export async function createVideoPost(platform, payload) {
  if (!PLATFORMS.includes(platform)) {
    throw new AppError('Unsupported publishing platform.', 400, 'UNSUPPORTED_PLATFORM');
  }

  const mutation = `
    mutation CreateVideoPost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            status
            text
            shareMode
            assets {
              source
            }
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const mode = normalizeMode(payload.mode);
  const input = {
    text: platform === 'youtube' ? payload.youtubeDescription : payload.caption,
    channelId: channelIdFor(platform),
    schedulingType: 'automatic',
    mode: mode === 'draft' ? 'addToQueue' : mode,
    saveToDraft: mode === 'draft',
    assets: [
      {
        video: {
          url: payload.videoUrl,
          metadata: platform === 'youtube' ? { title: payload.youtubeTitle } : { thumbnailOffset: 2000 }
        }
      }
    ]
  };

  const metadata = metadataFor(platform, payload);
  if (metadata) {
    input.metadata = metadata;
  }

  console.log(`[buffer] ${platform} publish started`);
  const data = await bufferGraphql(mutation, { input });
  const result = data.data?.createPost;

  if (result?.message) {
    throw new AppError(`Buffer rejected ${platform} post: ${result.message}`, 422, 'BUFFER_POST_REJECTED');
  }

  if (!result?.post?.id) {
    throw new AppError(`Buffer did not return a post ID for ${platform}.`, 502, 'BUFFER_POST_FAILED');
  }

  console.log(`[buffer] ${platform} publish complete`);
  return {
    status: mode === 'draft' ? 'draft' : 'published',
    bufferPostId: result.post.id,
    bufferStatus: result.post.status,
    mode,
    error: null
  };
}

export async function publishToSelectedPlatforms(platforms, payload, existingPublishing = {}) {
  const uniquePlatforms = [...new Set((platforms || []).filter((platform) => PLATFORMS.includes(platform)))];
  if (!uniquePlatforms.length) {
    throw new AppError('Select at least one platform to publish.', 400, 'NO_PLATFORMS_SELECTED');
  }

  const results = {};
  for (const platform of uniquePlatforms) {
    const existing = existingPublishing[platform];
    if (existing?.status === 'published' && existing.bufferPostId) {
      results[platform] = {
        ...existing,
        skipped: true,
        message: `Already published to ${platform}.`
      };
      continue;
    }

    try {
      results[platform] = await createVideoPost(platform, payload);
    } catch (error) {
      results[platform] = {
        status: 'failed',
        bufferPostId: null,
        error: error.message
      };
    }
  }

  return results;
}
