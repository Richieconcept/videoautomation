import path from 'node:path';
import { fetchAndDownload } from '../services/mediaDownloader.js';
import { processVideo } from '../services/videoEditor.js';
import { generateCaption } from '../services/caption.service.js';
import { uploadVideoToCloudinary } from '../services/cloudinary.service.js';
import { publishToSelectedPlatforms } from '../services/buffer.service.js';
import { cleanupLocalMediaFiles, findDownloadedVideo, findFinalVideo, findThumbnail, readMetadata, writeMetadata } from '../services/mediaStorage.js';
import { AppError } from '../utils/errors.js';

function shouldCleanupLocalMedia() {
  return !['0', 'false', 'no', 'off'].includes(String(process.env.CLEANUP_LOCAL_MEDIA_AFTER_CLOUDINARY || 'true').toLowerCase());
}

function toApiResponse(metadata, req) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const originalCaption = typeof metadata.caption === 'string'
    ? metadata.caption
    : metadata.caption?.original || metadata.description || metadata.title || '';
  return {
    success: true,
    jobId: metadata.jobId,
    platform: metadata.platform,
    sourceUrl: metadata.sourceUrl,
    resolvedUrl: metadata.resolvedUrl,
    title: metadata.title,
    description: metadata.description,
    caption: originalCaption,
    author: metadata.uploader,
    uploaderId: metadata.uploaderId,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    uploadDate: metadata.uploadDate,
    webpageUrl: metadata.webpageUrl,
    thumbnailUrl: metadata.thumbnailFileName ? `${baseUrl}/api/media/${metadata.jobId}/thumbnail` : null,
    videoUrl: `${baseUrl}/api/media/${metadata.jobId}/video`,
    downloadUrl: `${baseUrl}/api/media/${metadata.jobId}/video?download=1`,
    downloadStatus: metadata.downloadStatus,
    processingStatus: metadata.processingStatus || null,
    sourceDuration: metadata.sourceDuration || null,
    brandDuration: metadata.brandDuration || null,
    brandInsertionPoints: metadata.brandInsertionPoints || [],
    outroEnabled: metadata.outroEnabled ?? Boolean(metadata.finalFileName),
    finalDuration: metadata.finalDuration || null,
    finalVideoUrl: metadata.finalFileName ? `${baseUrl}/api/media/${metadata.jobId}/final` : null,
    finalDownloadUrl: metadata.finalFileName ? `${baseUrl}/api/media/${metadata.jobId}/final?download=1` : null,
    overlays: metadata.overlays || null,
    cloudinary: metadata.cloudinary
      ? {
          status: metadata.cloudinary.status,
          publicId: metadata.cloudinary.publicId,
          secureUrl: metadata.cloudinary.secureUrl,
          bytes: metadata.cloudinary.bytes,
          duration: metadata.cloudinary.duration,
          format: metadata.cloudinary.format
        }
      : null,
    generatedCaption: typeof metadata.caption === 'object' ? metadata.caption : null,
    publishing: metadata.publishing || null
  };
}

export async function fetchMedia(req, res, next) {
  try {
    const metadata = await fetchAndDownload(req.body?.url);
    res.status(201).json(toApiResponse(metadata, req));
  } catch (error) {
    next(error);
  }
}

export async function getMetadata(req, res, next) {
  try {
    const metadata = await readMetadata(req.params.jobId);
    res.json(toApiResponse(metadata, req));
  } catch (error) {
    next(error);
  }
}

export async function getVideo(req, res, next) {
  try {
    const video = await findDownloadedVideo(req.params.jobId);
    if (req.query.download === '1') {
      res.download(video.filePath, video.fileName);
      return;
    }
    res.sendFile(video.filePath);
  } catch (error) {
    next(error);
  }
}

export async function processMedia(req, res, next) {
  try {
    const metadata = await processVideo(req.params.jobId);
    res.json(toApiResponse(metadata, req));
  } catch (error) {
    next(error);
  }
}

export async function getFinalVideo(req, res, next) {
  try {
    const video = await findFinalVideo(req.params.jobId);
    if (req.query.download === '1') {
      res.download(video.filePath, video.fileName);
      return;
    }
    res.sendFile(video.filePath);
  } catch (error) {
    next(error);
  }
}

export async function uploadMedia(req, res, next) {
  try {
    const metadata = await readMetadata(req.params.jobId);

    if (metadata.cloudinary?.status === 'uploaded' && metadata.cloudinary?.secureUrl) {
      res.json(toApiResponse(metadata, req));
      return;
    }

    const finalVideo = await findFinalVideo(req.params.jobId);
    const cloudinaryResult = await uploadVideoToCloudinary(finalVideo.filePath, req.params.jobId);
    const updatedMetadata = {
      ...metadata,
      cloudinary: cloudinaryResult
    };
    await writeMetadata(req.params.jobId, updatedMetadata);

    if (shouldCleanupLocalMedia()) {
      await cleanupLocalMediaFiles(req.params.jobId);
      const cleanedMetadata = {
        ...updatedMetadata,
        localMediaCleanedAt: new Date().toISOString()
      };
      await writeMetadata(req.params.jobId, cleanedMetadata);
      res.json(toApiResponse(cleanedMetadata, req));
      return;
    }

    res.json(toApiResponse(updatedMetadata, req));
  } catch (error) {
    next(error);
  }
}

export async function generateMediaCaption(req, res, next) {
  try {
    const metadata = await readMetadata(req.params.jobId);
    const caption = generateCaption({
      caption: typeof metadata.caption === 'string' ? metadata.caption : metadata.caption?.original || metadata.description || '',
      title: metadata.title || '',
      platform: metadata.platform || '',
      uploader: metadata.uploader || metadata.author || '',
      sourceUrl: metadata.sourceUrl || ''
    });
    const updatedMetadata = {
      ...metadata,
      caption: {
        original: caption.original,
        generated: caption.generated,
        youtubeTitle: caption.youtubeTitle,
        youtubeDescription: caption.youtubeDescription,
        generatedAt: new Date().toISOString()
      }
    };
    await writeMetadata(req.params.jobId, updatedMetadata);

    if (metadata.cloudinary?.secureUrl && shouldCleanupLocalMedia()) {
      await cleanupLocalMediaFiles(req.params.jobId);
      const cleanedMetadata = {
        ...updatedMetadata,
        localMediaCleanedAt: new Date().toISOString()
      };
      await writeMetadata(req.params.jobId, cleanedMetadata);
      res.json(toApiResponse(cleanedMetadata, req));
      return;
    }

    res.json(toApiResponse(updatedMetadata, req));
  } catch (error) {
    next(error);
  }
}

export async function publishMedia(req, res, next) {
  try {
    let metadata = await readMetadata(req.params.jobId);

    const caption = String(req.body?.caption || metadata.caption?.generated || '').trim();
    const youtubeTitle = String(req.body?.youtubeTitle || metadata.caption?.youtubeTitle || '').trim();
    const youtubeDescription = String(req.body?.youtubeDescription || metadata.caption?.youtubeDescription || caption || '').trim();

    if (!caption) {
      throw new AppError('Generate or enter a caption before publishing.', 400, 'CAPTION_REQUIRED');
    }

    if (!metadata.cloudinary?.secureUrl) {
      const finalVideo = await findFinalVideo(req.params.jobId);
      const cloudinaryResult = await uploadVideoToCloudinary(finalVideo.filePath, req.params.jobId);
      metadata = {
        ...metadata,
        cloudinary: cloudinaryResult
      };
    }

    const platforms = req.body?.platforms || ['facebook', 'tiktok', 'youtube'];
    const results = await publishToSelectedPlatforms(platforms, {
      caption,
      youtubeTitle,
      youtubeDescription,
      videoUrl: metadata.cloudinary.secureUrl,
      mode: req.body?.mode
    }, metadata.publishing || {});

    const updatedPublishing = {
      ...(metadata.publishing || {}),
      ...results
    };

    const updatedMetadata = {
      ...metadata,
      caption: {
        original: typeof metadata.caption === 'string' ? metadata.caption : metadata.caption?.original || metadata.title || '',
        generated: caption,
        youtubeTitle,
        youtubeDescription,
        updatedAt: new Date().toISOString()
      },
      publishing: updatedPublishing
    };

    await writeMetadata(req.params.jobId, updatedMetadata);
    res.json(toApiResponse(updatedMetadata, req));
  } catch (error) {
    next(error);
  }
}

export async function getThumbnail(req, res, next) {
  try {
    const thumbnail = await findThumbnail(req.params.jobId);
    res.type(path.extname(thumbnail.fileName));
    res.sendFile(thumbnail.filePath);
  } catch (error) {
    next(error);
  }
}
