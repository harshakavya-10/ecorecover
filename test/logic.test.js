import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, CATEGORIES } from '../src/recommend.js';
import { score, rank, DEFAULT_WEIGHTS } from '../src/priority.js';
import { mapLabels } from '../src/classify.js';

test('recommendations follow condition', () => {
  assert.equal(recommend('laptop', 'working').action, 'reuse');
  assert.equal(recommend('laptop', 'repairable').action, 'repair');
  assert.equal(recommend('charger', 'non_functional').action, 'recycle');
});
test('batteries are always specialist and never advised to dismantle', () => {
  for (const cond of ['working', 'repairable', 'non_functional']) {
    const r = recommend('battery', cond);
    assert.equal(r.action, 'specialist_collection'); assert.equal(r.hazardous, true);
    assert.match(r.steps.join(' '), /Do not try to dismantle/);
  }
  for (const c of Object.keys(CATEGORIES)) assert.doesNotMatch(JSON.stringify(recommend(c)), /burn it|take apart/i);
});
test('priority score is deterministic, capped, and flags hazard', () => {
  const nowMs = Date.parse('2026-01-11T00:00:00Z');
  const r = { created_at: '2026-01-01 00:00:00', quantity: 2, category: 'cable' };
  const s = score(r, nowMs, DEFAULT_WEIGHTS);
  assert.equal(s.score, 10 * 2 + 3); assert.equal(s.queue, 'routine');
  assert.equal(score({ ...r, created_at: '2025-01-01 00:00:00', quantity: 50 }, nowMs, DEFAULT_WEIGHTS).score, 60 + 10);
  const h = score({ ...r, category: 'battery' }, nowMs, DEFAULT_WEIGHTS);
  assert.equal(h.queue, 'specialist'); assert.equal(h.score, 43);
  assert.equal(rank([r, { ...r, category: 'battery' }], nowMs)[0].category, 'battery');
});
test('configurable weights', () => {
  const r = { created_at: '2026-01-01 00:00:00', quantity: 1, category: 'cable' };
  assert.equal(score(r, Date.parse('2026-01-03T00:00:00Z'), { ...DEFAULT_WEIGHTS, waitPerDay: 5 }).score, 10 + 1.5);
});
test('rekognition label mapping and uncertainty', () => {
  assert.equal(mapLabels([{ Name: 'Mobile Phone', Confidence: 98.2 }]).category, 'mobile_phone');
  const u = mapLabels([{ Name: 'Mobile Phone', Confidence: 55 }, { Name: 'Table', Confidence: 99 }]);
  assert.equal(u.uncertain, true); assert.equal(u.category, 'other');
  assert.equal(mapLabels([{ Name: 'Dog', Confidence: 99 }]).uncertain, true);
});
