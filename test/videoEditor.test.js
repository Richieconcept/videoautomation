import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutroOnlyTimeline, calculateBrandInsertionPoints } from '../src/services/videoEditor.js';

test('calculateBrandInsertionPoints keeps deprecated timing behavior for compatibility', () => {
  assert.deepEqual(calculateBrandInsertionPoints(15), []);
  assert.deepEqual(calculateBrandInsertionPoints(19), []);
  assert.deepEqual(calculateBrandInsertionPoints(20), [10]);
  assert.deepEqual(calculateBrandInsertionPoints(45), [10]);
  assert.deepEqual(calculateBrandInsertionPoints(72), [10]);
  assert.deepEqual(calculateBrandInsertionPoints(90), [10, 70]);
  assert.deepEqual(calculateBrandInsertionPoints(130), [10, 70]);
  assert.deepEqual(calculateBrandInsertionPoints(180), [10, 70, 130]);
});

test('calculateBrandInsertionPoints still allows legacy configurable timing', () => {
  assert.deepEqual(calculateBrandInsertionPoints(100, 5, 30, 12, 20), [5, 35, 65]);
  assert.deepEqual(calculateBrandInsertionPoints(84, 5, 30, 12, 20), [5, 35]);
});

test('buildOutroOnlyTimeline does not create mid-video brand breaks', () => {
  assert.deepEqual(buildOutroOnlyTimeline(150, 6), [
    { type: 'source', start: 0, duration: 150 },
    { type: 'brand', start: 0, duration: 6, outro: true }
  ]);
});
