import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcceptCandidate } from '../src/services/sources/sourceWatcher.js';

function state(overrides = {}) {
  return {
    posts: [],
    counters: {
      queuedToday: 0,
      duplicatesSkippedToday: 0,
      failedToday: 0
    },
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    creatorId: 'verydarkman',
    sourceId: 'verydarkman-youtube',
    platform: 'youtube',
    externalPostId: 'abc123',
    url: 'https://www.youtube.com/watch?v=abc123&utm_source=test',
    title: 'Fresh trending update',
    duration: 120,
    publishedAt: new Date().toISOString(),
    ...overrides
  };
}

test('automation accepts a fresh video inside duration limits', () => {
  const decision = shouldAcceptCandidate(candidate(), state());
  assert.equal(decision.accepted, true);
  assert.equal(decision.normalizedUrl, 'https://www.youtube.com/watch?v=abc123');
});

test('automation rejects duplicate URLs', () => {
  const decision = shouldAcceptCandidate(candidate(), state({
    posts: [{
      normalizedUrl: 'https://www.youtube.com/watch?v=abc123',
      platform: 'youtube',
      externalPostId: 'abc123',
      creatorId: 'verydarkman',
      contentFingerprint: 'other'
    }]
  }));
  assert.equal(decision.accepted, false);
  assert.equal(decision.status, 'duplicate');
});

test('automation rejects short videos and trims long videos by default', () => {
  assert.equal(shouldAcceptCandidate(candidate({ duration: 4 }), state()).status, 'too_short');
  assert.equal(shouldAcceptCandidate(candidate({ duration: 301 }), state()).accepted, true);
});

test('automation can still reject long videos when trimming is disabled', () => {
  const previous = process.env.AUTO_TRIM_LONG_VIDEOS;
  process.env.AUTO_TRIM_LONG_VIDEOS = 'false';
  try {
    assert.equal(shouldAcceptCandidate(candidate({ duration: 301 }), state()).status, 'too_long');
  } finally {
    if (previous === undefined) {
      delete process.env.AUTO_TRIM_LONG_VIDEOS;
    } else {
      process.env.AUTO_TRIM_LONG_VIDEOS = previous;
    }
  }
});

test('automation enforces daily max queue limit', () => {
  const decision = shouldAcceptCandidate(candidate(), state({
    counters: {
      queuedToday: 10,
      duplicatesSkippedToday: 0,
      failedToday: 0
    }
  }));
  assert.equal(decision.accepted, false);
  assert.equal(decision.status, 'daily_limit');
});
