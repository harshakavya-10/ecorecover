// Transparent, deterministic scoring. Not a validated prediction model.
// Proximity is intentionally NOT used: the app only collects free-text localities, not valid coordinates.
import { CATEGORIES } from './recommend.js';

export const DEFAULT_WEIGHTS = {
  waitPerDay: 2, waitCap: 60,       // points per day waiting, capped
  perItem: 1.5, quantityCap: 10,    // points per item, capped
  hazardousBonus: 20,               // surfaces hazardous requests for specialist handling
};
export function getWeights() {
  try { return { ...DEFAULT_WEIGHTS, ...JSON.parse(process.env.PRIORITY_WEIGHTS || '{}') }; }
  catch { return DEFAULT_WEIGHTS; }
}
const toMs = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');

export function score(r, now = Date.now(), w = getWeights()) {
  const days = Math.max(0, Math.floor((now - toMs(r.created_at)) / 864e5));
  const waitPts = Math.min(days * w.waitPerDay, w.waitCap);
  const qtyPts = Math.min(r.quantity * w.perItem, w.quantityCap);
  const hazardous = !!CATEGORIES[r.category]?.hazard;
  const hazPts = hazardous ? w.hazardousBonus : 0;
  const reasons = [`Waiting ${days} day(s): +${waitPts}`, `Quantity ${r.quantity}: +${qtyPts}`];
  if (hazardous) reasons.push(`Hazardous category: +${hazPts} (specialist handling, not routine pickup)`);
  return { score: waitPts + qtyPts + hazPts, reasons, hazardous, queue: hazardous ? 'specialist' : 'routine' };
}
export function rank(rows, now = Date.now()) {
  return rows.map((r) => ({ ...r, priority: score(r, now) }))
    .sort((a, b) => b.priority.score - a.priority.score);
}
