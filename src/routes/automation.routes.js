import { Router } from 'express';
import {
  checkAllSources,
  checkCreatorSources,
  createCreator,
  getAutomation,
  processQueue,
  updateAutomationSettings
} from '../controllers/automation.controller.js';

const router = Router();

router.get('/', getAutomation);
router.post('/settings', updateAutomationSettings);
router.post('/check', checkAllSources);
router.post('/process-queue', processQueue);
router.post('/creators', createCreator);
router.post('/creators/:creatorId/check', checkCreatorSources);

export default router;
