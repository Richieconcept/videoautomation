import {
  createAutomationCreator,
  getAutomationSummary,
  processQueuedAutoJobs,
  runSourceCycle,
  setAutomationEnabled
} from '../services/sources/sourceWatcher.js';

export async function getAutomation(req, res, next) {
  try {
    res.json(await getAutomationSummary());
  } catch (error) {
    next(error);
  }
}

export async function updateAutomationSettings(req, res, next) {
  try {
    res.json(await setAutomationEnabled(req.body?.enabled));
  } catch (error) {
    next(error);
  }
}

export async function checkAllSources(req, res, next) {
  try {
    res.json(await runSourceCycle({ bootstrap: Boolean(req.body?.bootstrap) }));
  } catch (error) {
    next(error);
  }
}

export async function checkCreatorSources(req, res, next) {
  try {
    res.json(await runSourceCycle({ creatorId: req.params.creatorId, bootstrap: Boolean(req.body?.bootstrap) }));
  } catch (error) {
    next(error);
  }
}

export async function createCreator(req, res, next) {
  try {
    res.status(201).json(await createAutomationCreator(req.body));
  } catch (error) {
    next(error);
  }
}

export async function processQueue(req, res, next) {
  try {
    processQueuedAutoJobs().catch((error) => {
      console.error('[automation] manual processor failed', error);
    });
    res.json({ success: true, message: 'Auto queue processing started.' });
  } catch (error) {
    next(error);
  }
}
