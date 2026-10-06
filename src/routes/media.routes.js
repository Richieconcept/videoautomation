import { Router } from 'express';
import {
  fetchMedia,
  getFinalVideo,
  getMetadata,
  getThumbnail,
  getVideo,
  generateMediaCaption,
  processMedia,
  publishMedia,
  uploadMedia
} from '../controllers/media.controller.js';

const router = Router();

router.post('/fetch', fetchMedia);
router.post('/:jobId/process', processMedia);
router.post('/:jobId/upload', uploadMedia);
router.post('/:jobId/caption', generateMediaCaption);
router.post('/:jobId/publish', publishMedia);
router.get('/:jobId/video', getVideo);
router.get('/:jobId/final', getFinalVideo);
router.get('/:jobId/thumbnail', getThumbnail);
router.get('/:jobId/metadata', getMetadata);

export default router;
