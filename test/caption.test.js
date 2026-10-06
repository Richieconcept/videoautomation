import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCaption } from '../src/services/caption.service.js';

test('generateCaption creates branded caption without copying input exactly', () => {
  const result = generateCaption({
    caption: 'Portable causes scene at event',
    title: 'Portable causes scene at event',
    platform: 'tiktok',
    uploader: 'Example Upload'
  });

  assert.ok(result.generated.includes('#9jaTrendingTV'));
  assert.notEqual(result.generated.trim(), 'Portable causes scene at event');
  assert.ok(result.youtubeTitle.length >= 20);
  assert.ok(result.youtubeDescription.includes('What Nigeria Is Talking About'));
});

test('generateCaption does not expose TikTok numeric placeholder titles', () => {
  const result = generateCaption({
    title: 'TikTok video #7693548946219699474',
    platform: 'tiktok',
    uploader: 'Saida Boj'
  });

  assert.equal(result.original, '');
  assert.equal(result.generated.includes('7693548946219699474'), false);
  assert.equal(result.youtubeTitle.includes('7693548946219699474'), false);
});
