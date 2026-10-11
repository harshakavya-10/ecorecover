import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, seedIfEmpty } from './db.js';
import { CATEGORIES, CONDITIONS, recommend } from './recommend.js';
import { rank } from './priority.js';
import { classifyImage } from './classify.js';

seedIfEmpty();
const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET must be set in production'); process.exit(1);
}
const isTest = process.env.NODE_ENV === 'test';
const limiter = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max: isTest ? 10000 : max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, try again later.' } });

export const TRANSITIONS = {
  Submitted: ['Accepted', 'Cancelled'], Accepted: ['Scheduled', 'Cancelled'],
  Scheduled: ['Collected', 'Cancelled'], Collected: ['Completed'], Completed: [], Cancelled: [],
};
const ACTIVE = ['Submitted', 'Accepted', 'Scheduled'];
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const ok = (res, data, code = 200) => res.status(code).json({ data });
const fail = (res, code, error) => res.status(code).json({ error });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const auth = (roles) => (req, res, next) => {
  try {
    const p = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
    const u = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(p.id);
    if (!u) throw new Error('no user');
    req.user = u;
  } catch { return fail(res, 401, 'Authentication required'); }
  if (roles && !roles.includes(req.user.role)) return fail(res, 403, 'You do not have access to this');
  next();
};
const sign = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

function setStatus(id, to, userId, note) {
  db.prepare('UPDATE requests SET status=?, updated_at=? WHERE id=?').run(to, now(), id);
  db.prepare('INSERT INTO status_history (request_id,status,changed_by,note) VALUES (?,?,?,?)').run(id, to, userId, note || null);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const MAGIC = [['image/jpeg', [0xff, 0xd8, 0xff], 'jpg'], ['image/png', [0x89, 0x50, 0x4e, 0x47], 'png']];
function sniff(buf) {
  for (const [mime, sig, ext] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return { mime, ext };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
async function storeImage(buf, ext) {
  const key = `uploads/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  try {
    if (process.env.S3_BUCKET) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      await new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' })
        .send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buf }));
    } else {
      fs.mkdirSync('uploads', { recursive: true });
      fs.writeFileSync(key, buf);
    }
    return key;
  } catch (e) { console.error('Image store failed:', e.name); return null; }
}

// scoped WHERE builder: normal users only ever see their own rows
function filt(req) {
  const w = [], p = [], q = req.query;
  if (req.user.role === 'user') { w.push('user_id=?'); p.push(req.user.id); }
  if (q.from) { w.push('date(created_at)>=date(?)'); p.push(String(q.from)); }
  if (q.to) { w.push('date(created_at)<=date(?)'); p.push(String(q.to)); }
  if (q.category) { w.push('category=?'); p.push(String(q.category)); }
  if (q.locality) { w.push('locality=?'); p.push(String(q.locality)); }
  return [w.length ? 'WHERE ' + w.join(' AND ') : '', p];
}
export const ASSUMPTIONS = 'ESTIMATES ONLY. Weight = quantity x assumed average kg per category (phone 0.2, laptop 2.5, charger 0.15, cable 0.1, circuit board 0.3, battery 0.05, other 1). "Collected" = status Collected or Completed. Not independently verified recycling.';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

// ---------- auth ----------
app.post('/api/auth/register', limiter(20), wrap((req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80) return fail(res, 400, 'Name must be 2-80 characters');
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return fail(res, 409, 'Email already registered');
  const r = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run(name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 10), 'user'); // role is never client-controlled
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  ok(res, { token: sign(u), user: pub(u) }, 201);
}));
app.post('/api/auth/login', limiter(20), wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = typeof email === 'string' && db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!u || typeof password !== 'string' || !bcrypt.compareSync(password, u.password_hash)) return fail(res, 401, 'Invalid email or password');
  ok(res, { token: sign(u), user: pub(u) });
}));
app.get('/api/auth/me', auth(), (req, res) => ok(res, req.user));

// ---------- waste ----------
app.get('/api/waste/categories', (req, res) => ok(res, Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, hazardous: c.hazard }))));
app.get('/api/waste/recommendation', (req, res) => {
  const { category, condition = 'non_functional' } = req.query;
  if (!CATEGORIES[category] || !CONDITIONS.includes(condition)) return fail(res, 400, 'Invalid category or condition');
  ok(res, recommend(category, condition));
});
app.post('/api/waste/classify', limiter(30), auth(), (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : 'Upload failed');
    next();
  }), wrap(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Attach an image in the "image" field');
    const type = sniff(req.file.buffer);
    if (!type) return fail(res, 400, 'Only JPEG, PNG or WebP images are allowed');
    const result = await classifyImage(req.file.buffer);
    const key = await storeImage(req.file.buffer, type.ext);
    const r = db.prepare('INSERT INTO classifications (user_id,category,confidence,mode,image_key,image_mime,image_bytes) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, result.category, result.confidence, result.mode, key, type.mime, req.file.size);
    ok(res, { id: Number(r.lastInsertRowid), ...result, suggestedRecommendation: result.category ? recommend(result.category) : null });
  }));

// ---------- requests ----------
const clean = (s, min, max) => typeof s === 'string' && s.trim().length >= min && s.trim().length <= max;
app.post('/api/requests', auth(), wrap((req, res) => {
  const b = req.body || {};
  if (!CATEGORIES[b.category]) return fail(res, 400, 'Choose a valid category');
  if (!CONDITIONS.includes(b.condition)) return fail(res, 400, 'Choose a valid condition');
  if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 50) return fail(res, 400, 'Quantity must be a whole number from 1 to 50');
  if (!['pickup', 'dropoff'].includes(b.mode)) return fail(res, 400, 'Choose pickup or drop-off');
  if (!clean(b.city, 2, 80) || !clean(b.locality, 2, 80)) return fail(res, 400, 'Enter your city and locality');
  if (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 500)) return fail(res, 400, 'Notes must be 500 characters or fewer');
  let ai = null, cid = null;
  if (b.classification_id != null) {
    const c = db.prepare('SELECT * FROM classifications WHERE id=? AND user_id=?').get(b.classification_id, req.user.id);
    if (!c) return fail(res, 400, 'Unknown classification');
    ai = c.category; cid = c.id;
  }
  const id = 'ER-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare(`INSERT INTO requests (id,user_id,category,ai_category,classification_id,condition,quantity,mode,city,locality,notes,hazardous,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, b.category, ai, cid, b.condition, b.quantity, b.mode,
    b.city.trim(), b.locality.trim(), b.notes?.trim() || null, CATEGORIES[b.category].hazard ? 1 : 0, now(), now());
  db.prepare('INSERT INTO status_history (request_id,status,changed_by) VALUES (?,?,?)').run(id, 'Submitted', req.user.id);
  ok(res, { id, status: 'Submitted', recommendation: recommend(b.category, b.condition) }, 201);
}));

app.get('/api/requests', auth(), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const [w, p] = filt(req);
  const total = db.prepare(`SELECT COUNT(*) c FROM requests ${w}`).get(...p).c;
  const items = db.prepare(`SELECT * FROM requests ${w} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).all(...p, limit, (page - 1) * limit)
    .map((r) => ({ ...r, next: TRANSITIONS[r.status] }));
  ok(res, { items, total, page, limit });
});
app.get('/api/requests/:id', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!r || (req.user.role === 'user' && r.user_id !== req.user.id)) return fail(res, 404, 'Request not found');
  const history = db.prepare('SELECT status,note,created_at FROM status_history WHERE request_id=? ORDER BY id').all(r.id);
  ok(res, { ...r, history, next: TRANSITIONS[r.status], recommendation: recommend(r.category, r.condition) });
});
app.patch('/api/requests/:id/status', auth(['partner', 'admin']), (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!r) return fail(res, 404, 'Request not found');
  const to = req.body?.status;
  if (!(r.status in TRANSITIONS) || !TRANSITIONS[r.status].includes(to))
    return fail(res, 409, `Cannot move from ${r.status} to ${to}. Allowed: ${TRANSITIONS[r.status].join(', ') || 'none'}`);
  setStatus(r.id, to, req.user.id, req.body?.note);
  ok(res, { id: r.id, status: to });
});
app.patch('/api/requests/:id/cancel', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!r || (req.user.role === 'user' && r.user_id !== req.user.id)) return fail(res, 404, 'Request not found');
  if (!TRANSITIONS[r.status].includes('Cancelled')) return fail(res, 409, `A ${r.status} request cannot be cancelled`);
  setStatus(r.id, 'Cancelled', req.user.id, 'Cancelled by requester');
  ok(res, { id: r.id, status: 'Cancelled' });
});

// ---------- admin / partner ----------
app.get('/api/admin/requests', auth(['partner', 'admin']), (req, res) => {
  const rows = db.prepare(`SELECT * FROM requests WHERE status IN (${ACTIVE.map(() => '?').join(',')})`).all(...ACTIVE);
  ok(res, rank(rows).map((r) => ({ ...r, next: TRANSITIONS[r.status] })));
});
app.get('/api/admin/partners', auth(['admin']), (req, res) => {
  ok(res, db.prepare(`SELECT u.id,u.name,u.email,u.created_at,
    (SELECT COUNT(*) FROM status_history h WHERE h.changed_by=u.id) AS updates FROM users u WHERE role='partner'`).all());
});

// ---------- analytics (computed from DB rows; users see only their own) ----------
app.get('/api/analytics/overview', auth(), (req, res) => {
  const [w, p] = filt(req);
  const rows = db.prepare(`SELECT category,status,SUM(quantity) q,COUNT(*) n FROM requests ${w} GROUP BY category,status`).all(...p);
  const byStatus = {}; let kgReq = 0, kgCol = 0, total = 0;
  for (const r of rows) {
    total += r.n; byStatus[r.status] = (byStatus[r.status] || 0) + r.n;
    if (r.status === 'Cancelled') continue;
    const kg = r.q * (CATEGORIES[r.category]?.kg ?? 1);
    kgReq += kg; if (['Collected', 'Completed'].includes(r.status)) kgCol += kg;
  }
  const cw = [], cp = [];
  if (req.user.role === 'user') { cw.push('user_id=?'); cp.push(req.user.id); }
  if (req.query.from) { cw.push('date(created_at)>=date(?)'); cp.push(String(req.query.from)); }
  if (req.query.to) { cw.push('date(created_at)<=date(?)'); cp.push(String(req.query.to)); }
  if (req.query.category) { cw.push('category=?'); cp.push(String(req.query.category)); }
  const identified = db.prepare(`SELECT COUNT(*) c FROM classifications ${cw.length ? 'WHERE ' + cw.join(' AND ') : ''}`).get(...cp).c;
  const pending = ACTIVE.reduce((s, k) => s + (byStatus[k] || 0), 0);
  ok(res, { identified, totalRequests: total, pending, completed: (byStatus.Completed || 0) + (byStatus.Collected || 0),
    cancelled: byStatus.Cancelled || 0, byStatus, estimatedKgRequested: +kgReq.toFixed(1), estimatedKgCollected: +kgCol.toFixed(1), assumptions: ASSUMPTIONS });
});
app.get('/api/analytics/categories', auth(), (req, res) => {
  const [w, p] = filt(req);
  ok(res, db.prepare(`SELECT category AS label, COUNT(*) AS value FROM requests ${w} GROUP BY category ORDER BY value DESC`).all(...p));
});
app.get('/api/analytics/trends', auth(), (req, res) => {
  const [w, p] = filt(req);
  ok(res, db.prepare(`SELECT strftime('%Y-W%W', created_at) AS label, COUNT(*) AS value FROM requests ${w} GROUP BY label ORDER BY label`).all(...p));
});
app.get('/api/analytics/localities', auth(), (req, res) => {
  const [w, p] = filt(req);
  ok(res, db.prepare(`SELECT locality AS label, COUNT(*) AS value FROM requests ${w} GROUP BY locality ORDER BY value DESC LIMIT 15`).all(...p));
});

app.use('/api', (req, res) => fail(res, 404, 'Not found'));
app.use(express.static(path.join(here, '..', 'public')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON');
  console.error(err);
  fail(res, 500, 'Something went wrong');
});
