const form = document.querySelector('#fetch-form');
const input = document.querySelector('#media-url');
const button = document.querySelector('#fetch-button');
const statusBox = document.querySelector('#status');
const result = document.querySelector('#result');
const processStatus = document.querySelector('#process-status');
const processButton = document.querySelector('#process-button');
const finalResult = document.querySelector('#final-result');
const overlayStatus = document.querySelector('#overlay-status');
const publishPanel = document.querySelector('#publish-panel');
const publishMessage = document.querySelector('#publish-message');
const autoToggle = document.querySelector('#auto-toggle');
const autoCheckAll = document.querySelector('#auto-check-all');
const autoMessage = document.querySelector('#auto-message');
const creatorForm = document.querySelector('#creator-form');
const creatorList = document.querySelector('#creator-list');
const recentPosts = document.querySelector('#recent-posts');
const autoFields = {
  mode: document.querySelector('#auto-mode'),
  queued: document.querySelector('#auto-queued'),
  processed: document.querySelector('#auto-processed'),
  nextCheck: document.querySelector('#auto-next-check'),
  creatorName: document.querySelector('#creator-name'),
  creatorFacebook: document.querySelector('#creator-facebook'),
  creatorTikTok: document.querySelector('#creator-tiktok'),
  creatorYouTube: document.querySelector('#creator-youtube')
};

let currentJobId = null;
let automationEnabled = false;
let manualPipelinePoller = null;

const fields = {
  platform: document.querySelector('#platform'),
  author: document.querySelector('#author'),
  duration: document.querySelector('#duration'),
  source: document.querySelector('#source'),
  caption: document.querySelector('#caption'),
  video: document.querySelector('#video'),
  download: document.querySelector('#download'),
  thumbnailWrap: document.querySelector('#thumbnail-wrap'),
  thumbnail: document.querySelector('#thumbnail'),
  finalVideo: document.querySelector('#final-video'),
  finalDuration: document.querySelector('#final-duration'),
  outroStatus: document.querySelector('#outro-status'),
  downloadFinal: document.querySelector('#download-final'),
  logoOverlayStatus: document.querySelector('#logo-overlay-status'),
  logoOverlayPosition: document.querySelector('#logo-overlay-position'),
  logoOverlaySize: document.querySelector('#logo-overlay-size'),
  reactionOverlayStatus: document.querySelector('#reaction-overlay-status'),
  reactionOverlayPosition: document.querySelector('#reaction-overlay-position'),
  reactionOverlaySize: document.querySelector('#reaction-overlay-size'),
  originalCaption: document.querySelector('#original-caption'),
  generatedCaption: document.querySelector('#generated-caption'),
  youtubeTitle: document.querySelector('#youtube-title'),
  youtubeDescription: document.querySelector('#youtube-description'),
  cloudinaryStatus: document.querySelector('#cloudinary-status'),
  cloudinaryUrl: document.querySelector('#cloudinary-url'),
  captionStatus: document.querySelector('#caption-status'),
  facebookStatus: document.querySelector('#facebook-status'),
  tiktokStatus: document.querySelector('#tiktok-status'),
  youtubeStatus: document.querySelector('#youtube-status'),
  publishMode: document.querySelector('#publish-mode'),
  generateCaptionButton: document.querySelector('#generate-caption-button'),
  uploadButton: document.querySelector('#upload-button'),
  publishAll: document.querySelector('#publish-all'),
  publishFacebook: document.querySelector('#publish-facebook'),
  publishTikTok: document.querySelector('#publish-tiktok'),
  publishYouTube: document.querySelector('#publish-youtube')
};

const progressMessages = [
  'Detecting platform...',
  'Fetching metadata...',
  'Downloading video...'
];

const processingMessages = [
  'Preparing video...',
  'Analyzing duration...',
  'Adding logo and reaction overlays...',
  'Appending 9ja Trending TV outro...',
  'Rendering final video...'
];

function setStatus(message, type = 'neutral') {
  statusBox.textContent = message;
  statusBox.dataset.type = type;
}

function setLoading(isLoading) {
  button.disabled = isLoading;
  input.disabled = isLoading;
  button.textContent = isLoading ? 'Fetching...' : 'Fetch Video';
}

function setProcessing(isProcessing) {
  processButton.disabled = isProcessing;
  processButton.textContent = isProcessing ? 'Processing...' : finalResult.classList.contains('hidden') ? 'Process Video' : 'Reprocess Video';
}

function formatDuration(seconds) {
  if (!seconds) return 'Unavailable';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;
}

function formatDateTime(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleString();
}

function sourceStatusText(source, isCycleRunning) {
  if (source.lastError) return source.lastError;
  if (source.lastCheckedAt) return `Last checked: ${formatDateTime(source.lastCheckedAt)}`;
  if (source.lastCheckStartedAt || isCycleRunning) return 'Checking now...';
  return 'Not checked yet';
}

function setAutoMessage(message, type = 'neutral') {
  autoMessage.textContent = message;
  autoMessage.dataset.type = type;
}

async function automationJson(url, body = null) {
  const options = body
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }
    : {};
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Automation request failed.');
  }
  return data;
}

function renderAutomation(data) {
  automationEnabled = Boolean(data.settings?.autoSourcingEnabled);
  autoToggle.textContent = automationEnabled ? 'Turn Off' : 'Turn On';
  autoFields.mode.textContent = automationEnabled ? 'On' : 'Off';
  autoFields.queued.textContent = data.counters?.queuedToday || 0;
  autoFields.processed.textContent = data.counters?.processedToday || 0;
  autoFields.nextCheck.textContent = formatDateTime(data.settings?.nextCycleAt);

  creatorList.innerHTML = '';
  (data.creators || []).forEach((creator) => {
    const card = document.createElement('article');
    card.className = 'creator-card';
    const sources = (creator.sources || []).map((source) => `
      <div class="source-row">
        <strong>${source.platform}</strong>
        <div>
          <a href="${source.profileUrl}" target="_blank" rel="noreferrer">${source.profileUrl}</a>
          <span>${sourceStatusText(source, data.running?.cycleRunning)}</span>
        </div>
      </div>
    `).join('');

    card.innerHTML = `
      <h3>${creator.name}</h3>
      <div class="creator-source-actions">
        <button class="mini-button creator-check" type="button" data-creator-id="${creator.id}">Check now</button>
      </div>
      ${sources}
    `;
    creatorList.append(card);
  });

  recentPosts.innerHTML = '';
  (data.recentPosts || []).slice(0, 10).forEach((post) => {
    const item = document.createElement('article');
    item.className = 'recent-post';
    item.innerHTML = `
      <strong>${post.status}</strong>
      <a href="${post.url}" target="_blank" rel="noreferrer">${post.title || post.url}</a>
      <span>${post.platform}</span>
    `;
    recentPosts.append(item);
  });
}

async function loadAutomation() {
  try {
    const data = await automationJson('/api/automation');
    renderAutomation(data);
    setAutoMessage(data.running?.processorRunning ? 'Processing auto queue in background.' : 'Auto sourcing is ready.');
  } catch (error) {
    setAutoMessage(error.message, 'error');
  }
}

function displayResult(data) {
  currentJobId = data.jobId;
  fields.platform.textContent = (data.platform || 'unknown').replace('_', ' ');
  fields.author.textContent = data.author || 'Unavailable';
  fields.duration.textContent = formatDuration(data.duration);
  fields.source.href = data.sourceUrl;
  fields.caption.textContent = data.caption || data.title || 'No caption or title was available.';
  if (data.videoUrl) {
    fields.video.src = data.videoUrl;
  } else {
    fields.video.removeAttribute('src');
  }
  fields.download.href = data.downloadUrl || '#';
  processStatus.classList.add('hidden');
  overlayStatus.classList.add('hidden');
  publishPanel.classList.add('hidden');
  finalResult.classList.add('hidden');
  setProcessing(false);

  if (data.thumbnailUrl) {
    fields.thumbnail.src = data.thumbnailUrl;
    fields.thumbnailWrap.classList.remove('hidden');
  } else {
    fields.thumbnail.removeAttribute('src');
    fields.thumbnailWrap.classList.add('hidden');
  }

  result.classList.remove('hidden');

  if (data.finalVideoUrl) {
    displayFinalResult(data);
  }

  updateManualPipelineStatus(data);
}

function setProcessStatus(message, type = 'neutral') {
  processStatus.textContent = message;
  processStatus.dataset.type = type;
  processStatus.classList.remove('hidden');
}

function displayFinalResult(data) {
  if (data.finalVideoUrl) {
    fields.finalVideo.src = data.finalVideoUrl;
  } else {
    fields.finalVideo.removeAttribute('src');
  }
  fields.finalDuration.textContent = formatDuration(data.finalDuration);
  fields.outroStatus.textContent = data.outroEnabled ? 'Enabled' : 'Disabled';
  fields.downloadFinal.href = data.finalDownloadUrl || '#';
  if (data.overlays) {
    fields.logoOverlayStatus.textContent = data.overlays.logo?.enabled ? 'Enabled' : 'Disabled';
    fields.logoOverlayPosition.textContent = data.overlays.logo?.position || 'top-left';
    fields.logoOverlaySize.textContent = `${data.overlays.logo?.widthPercent || 0}%`;
    fields.reactionOverlayStatus.textContent = data.overlays.reaction?.enabled ? 'Enabled' : 'Disabled';
    fields.reactionOverlayPosition.textContent = data.overlays.reaction?.position || 'bottom-left';
    fields.reactionOverlaySize.textContent = `${data.overlays.reaction?.widthPercent || 0}%`;
    overlayStatus.classList.remove('hidden');
  }
  finalResult.classList.remove('hidden');
  displayPublishingState(data);
  publishPanel.classList.remove('hidden');
  setProcessing(false);
}

function updateManualPipelineStatus(data) {
  const pipeline = data.manualPipeline;
  if (!pipeline) return;

  if (pipeline.status === 'queued') {
    setProcessStatus('Downloaded. Editing, uploading, and sending to Buffer automatically...');
    return;
  }

  if (pipeline.status === 'running') {
    setProcessStatus('Automatic processing is running: edit, Cloudinary upload, Buffer send...');
    return;
  }

  if (pipeline.status === 'completed') {
    setProcessStatus('Automatic processing completed and sent to Buffer.', 'success');
    stopManualPipelinePolling();
    displayPublishingState(data);
    publishPanel.classList.remove('hidden');
    return;
  }

  if (pipeline.status === 'failed') {
    setProcessStatus(pipeline.error || 'Automatic processing failed.', 'error');
    stopManualPipelinePolling();
  }
}

function stopManualPipelinePolling() {
  if (manualPipelinePoller) {
    clearInterval(manualPipelinePoller);
    manualPipelinePoller = null;
  }
}

function startManualPipelinePolling(jobId) {
  stopManualPipelinePolling();
  manualPipelinePoller = setInterval(async () => {
    try {
      const response = await fetch(`/api/media/${jobId}/metadata`);
      const data = await response.json();
      if (!response.ok || !data.success) return;
      displayResult(data);
    } catch {
      // Keep the current UI state; the next poll can recover.
    }
  }, 8000);
}

function setPublishMessage(message, type = 'neutral') {
  publishMessage.textContent = message;
  publishMessage.dataset.type = type;
  publishMessage.classList.remove('hidden');
}

function displayPublishingState(data) {
  fields.originalCaption.value = data.caption || '';

  if (data.generatedCaption) {
    fields.generatedCaption.value = data.generatedCaption.generated || '';
    fields.youtubeTitle.value = data.generatedCaption.youtubeTitle || '';
    fields.youtubeDescription.value = data.generatedCaption.youtubeDescription || '';
    fields.captionStatus.textContent = 'Generated';
  } else {
    fields.generatedCaption.value = fields.generatedCaption.value || '';
    fields.youtubeTitle.value = fields.youtubeTitle.value || '';
    fields.youtubeDescription.value = fields.youtubeDescription.value || '';
    fields.captionStatus.textContent = 'Ready';
  }

  if (data.cloudinary?.secureUrl) {
    fields.cloudinaryStatus.textContent = 'Uploaded';
    fields.cloudinaryUrl.href = data.cloudinary.secureUrl;
    fields.cloudinaryUrl.classList.remove('hidden');
  } else {
    fields.cloudinaryStatus.textContent = 'Ready';
    fields.cloudinaryUrl.classList.add('hidden');
  }

  const publishing = data.publishing || {};
  fields.facebookStatus.textContent = statusLabel(publishing.facebook);
  fields.tiktokStatus.textContent = statusLabel(publishing.tiktok);
  fields.youtubeStatus.textContent = statusLabel(publishing.youtube);
}

function statusLabel(result) {
  if (!result) return 'Ready';
  if (result.skipped) return 'Already published';
  if (result.status === 'published') return 'Published';
  if (result.status === 'draft') return 'Draft';
  if (result.status === 'failed') return 'Failed';
  return result.status || 'Ready';
}

function startProgressTicker() {
  let index = 0;
  setStatus(progressMessages[index]);
  return setInterval(() => {
    index = Math.min(index + 1, progressMessages.length - 1);
    setStatus(progressMessages[index]);
  }, 1800);
}

function startProcessingTicker() {
  let index = 0;
  setProcessStatus(processingMessages[index]);
  return setInterval(() => {
    index = Math.min(index + 1, processingMessages.length - 1);
    setProcessStatus(processingMessages[index]);
  }, 2200);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();

  if (!url) {
    setStatus('Please paste a URL first.', 'error');
    return;
  }

  result.classList.add('hidden');
  setLoading(true);
  const ticker = startProgressTicker();

  try {
    const response = await fetch('/api/media/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Could not fetch this video.');
    }

    displayResult(data);
    if (data.manualPipeline) {
      setStatus('Downloaded. Auto processing started.', 'success');
      startManualPipelinePolling(data.jobId);
    } else {
      setStatus('Completed', 'success');
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    clearInterval(ticker);
    setLoading(false);
  }
});

processButton.addEventListener('click', async () => {
  if (!currentJobId) {
    setProcessStatus('Fetch a video before processing.', 'error');
    return;
  }

  setProcessing(true);
  finalResult.classList.add('hidden');
  const ticker = startProcessingTicker();

  try {
    const response = await fetch(`/api/media/${currentJobId}/process`, {
      method: 'POST'
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Could not process this video.');
    }

    displayFinalResult(data);
    setProcessStatus('Completed', 'success');
  } catch (error) {
    setProcessStatus(error.message, 'error');
  } finally {
    clearInterval(ticker);
    setProcessing(false);
  }
});

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

fields.generateCaptionButton.addEventListener('click', async () => {
  if (!currentJobId) return;
  fields.generateCaptionButton.disabled = true;
  setPublishMessage('Generating caption...');
  try {
    const data = await postJson(`/api/media/${currentJobId}/caption`);
    displayPublishingState(data);
    setPublishMessage('Caption generated', 'success');
  } catch (error) {
    setPublishMessage(error.message, 'error');
  } finally {
    fields.generateCaptionButton.disabled = false;
  }
});

fields.uploadButton.addEventListener('click', async () => {
  if (!currentJobId) return;
  fields.uploadButton.disabled = true;
  setPublishMessage('Uploading video...');
  try {
    const data = await postJson(`/api/media/${currentJobId}/upload`);
    displayPublishingState(data);
    setPublishMessage('Cloudinary upload completed', 'success');
  } catch (error) {
    setPublishMessage(error.message, 'error');
  } finally {
    fields.uploadButton.disabled = false;
  }
});

async function publish(platforms) {
  if (!currentJobId) return;
  setPublishMessage('Publishing...');
  try {
    const data = await postJson(`/api/media/${currentJobId}/publish`, {
      platforms,
      caption: fields.generatedCaption.value,
      youtubeTitle: fields.youtubeTitle.value,
      youtubeDescription: fields.youtubeDescription.value,
      mode: fields.publishMode.value
    });
    displayPublishingState(data);
    setPublishMessage('Publishing request completed', 'success');
  } catch (error) {
    setPublishMessage(error.message, 'error');
  }
}

fields.publishAll.addEventListener('click', () => publish(['facebook', 'tiktok', 'youtube']));
fields.publishFacebook.addEventListener('click', () => publish(['facebook']));
fields.publishTikTok.addEventListener('click', () => publish(['tiktok']));
fields.publishYouTube.addEventListener('click', () => publish(['youtube']));

autoToggle.addEventListener('click', async () => {
  autoToggle.disabled = true;
  setAutoMessage(automationEnabled ? 'Turning automation off...' : 'Turning automation on...');
  try {
    renderAutomation(await automationJson('/api/automation/settings', { enabled: !automationEnabled }));
    setAutoMessage(automationEnabled ? 'Auto sourcing is on.' : 'Auto sourcing is off.', 'success');
  } catch (error) {
    setAutoMessage(error.message, 'error');
  } finally {
    autoToggle.disabled = false;
  }
});

autoCheckAll.addEventListener('click', async () => {
  autoCheckAll.disabled = true;
  setAutoMessage('Checking all creator sources...');
  try {
    await automationJson('/api/automation/check', { bootstrap: false });
    await loadAutomation();
    setAutoMessage('Source check started. Any accepted videos are queued for background processing.', 'success');
  } catch (error) {
    setAutoMessage(error.message, 'error');
  } finally {
    autoCheckAll.disabled = false;
  }
});

creatorList.addEventListener('click', async (event) => {
  const button = event.target.closest('.creator-check');
  if (!button) return;
  button.disabled = true;
  setAutoMessage('Checking creator sources...');
  try {
    await automationJson(`/api/automation/creators/${button.dataset.creatorId}/check`, { bootstrap: false });
    await loadAutomation();
    setAutoMessage('Creator check started.', 'success');
  } catch (error) {
    setAutoMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

creatorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = autoFields.creatorName.value.trim();
  if (!name) {
    setAutoMessage('Add a creator name first.', 'error');
    return;
  }

  try {
    const data = await automationJson('/api/automation/creators', {
      name,
      facebookUrl: autoFields.creatorFacebook.value.trim(),
      tiktokUrl: autoFields.creatorTikTok.value.trim(),
      youtubeUrl: autoFields.creatorYouTube.value.trim()
    });
    creatorForm.reset();
    renderAutomation(data);
    setAutoMessage('Creator added.', 'success');
  } catch (error) {
    setAutoMessage(error.message, 'error');
  }
});

loadAutomation();
setInterval(loadAutomation, 30_000);
