import { generateCaption } from './caption.service.js';
import { uploadVideoToCloudinary } from './cloudinary.service.js';
import { publishToSelectedPlatforms } from './buffer.service.js';
import { cleanupLocalMediaFiles, findFinalVideo, readMetadata, writeMetadata } from './mediaStorage.js';

function shouldCleanupLocalMedia() {
  return !['0', 'false', 'no', 'off'].includes(String(process.env.CLEANUP_LOCAL_MEDIA_AFTER_CLOUDINARY || 'true').toLowerCase());
}

export async function processForPublishing(jobId, options = {}) {
  let metadata = await readMetadata(jobId);

  if (!metadata.cloudinary?.secureUrl) {
    const finalVideo = await findFinalVideo(jobId);
    metadata = {
      ...metadata,
      cloudinary: await uploadVideoToCloudinary(finalVideo.filePath, jobId)
    };
  }

  const generatedCaption = metadata.caption && typeof metadata.caption === 'object'
    ? metadata.caption
    : generateCaption({
        caption: typeof metadata.caption === 'string' ? metadata.caption : metadata.description || '',
        title: metadata.title || '',
        platform: metadata.platform || '',
        uploader: metadata.uploader || '',
        sourceUrl: metadata.sourceUrl || ''
      });

  const results = await publishToSelectedPlatforms(options.platforms || ['facebook', 'tiktok', 'youtube'], {
    caption: options.caption || generatedCaption.generated,
    youtubeTitle: options.youtubeTitle || generatedCaption.youtubeTitle,
    youtubeDescription: options.youtubeDescription || generatedCaption.youtubeDescription,
    videoUrl: metadata.cloudinary.secureUrl,
    mode: options.mode
  }, metadata.publishing || {});

  const updatedMetadata = {
    ...metadata,
    caption: {
      original: generatedCaption.original || '',
      generated: options.caption || generatedCaption.generated,
      youtubeTitle: options.youtubeTitle || generatedCaption.youtubeTitle,
      youtubeDescription: options.youtubeDescription || generatedCaption.youtubeDescription,
      updatedAt: new Date().toISOString()
    },
    publishing: {
      ...(metadata.publishing || {}),
      ...results
    }
  };

  await writeMetadata(jobId, updatedMetadata);

  if (metadata.cloudinary?.secureUrl && shouldCleanupLocalMedia()) {
    await cleanupLocalMediaFiles(jobId);
    const cleanedMetadata = {
      ...updatedMetadata,
      localMediaCleanedAt: new Date().toISOString()
    };
    await writeMetadata(jobId, cleanedMetadata);
    return cleanedMetadata;
  }

  return updatedMetadata;
}
