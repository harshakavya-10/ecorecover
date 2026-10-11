process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CLASSIFIER = 'demo';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let server, base;
const { app } = await import('../src/app.js');
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}/api`; r(); }); }));
after(() => server.close());

const call = async (path, { method = 'GET', token, json, form } = {}) => {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token;
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: json ? JSON.stringify(json) : form });
  return { status: res.status, body: await res.json() };
};
const login = async (email, password) => (await call('/auth/login', { method: 'POST', json: { email, password } })).body.data.token;
const reqBody = { category: 'mobile_phone', condition: 'non_functional', quantity: 2, mode: 'pickup', city: 'Mumbai', locality: 'Andheri' };

test('register, login, me; role cannot be self-assigned', async () => {
  const r = await call('/auth/register', { method: 'POST', json: { name: 'Asha', email: 'asha@test.dev', password: 'password123', role: 'admin' } });
  assert.equal(r.status, 201); assert.equal(r.body.data.user.role, 'user');
  assert.equal((await call('/auth/register', { method: 'POST', json: { name: 'Asha', email: 'asha@test.dev', password: 'password123' } })).status, 409);
  assert.equal((await call('/auth/login', { method: 'POST', json: { email: 'asha@test.dev', password: 'wrong-pass' } })).status, 401);
  assert.equal((await call('/auth/me', { token: r.body.data.token })).body.data.email, 'asha@test.dev');
  assert.equal((await call('/auth/register', { method: 'POST', json: { name: 'X', email: 'bad', password: '1' } })).status, 400);
});

test('protected endpoints and role checks', async () => {
  assert.equal((await call('/requests')).status, 401);
  const u = await login('user@demo.test', 'User@1234');
  assert.equal((await call('/admin/requests', { token: u })).status, 403);
  assert.equal((await call('/admin/partners', { token: await login('partner@demo.test', 'Partner@123') })).status, 403);
  assert.equal((await call('/admin/partners', { token: await login('admin@demo.test', 'Admin@123') })).status, 200);
});

test('upload validation and demo-labelled classification', async () => {
  const t = await login('user@demo.test', 'User@1234');
  const txt = new FormData(); txt.append('image', new Blob(['hello'], { type: 'image/png' }), 'x.png');
  assert.equal((await call('/waste/classify', { method: 'POST', token: t, form: txt })).status, 400);
  const big = new FormData(); big.append('image', new Blob([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(6 * 1024 * 1024)])], { type: 'image/png' }), 'b.png');
  assert.equal((await call('/waste/classify', { method: 'POST', token: t, form: big })).status, 400);
  const png = new FormData(); png.append('image', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])], { type: 'image/png' }), 'ok.png');
  const r = await call('/waste/classify', { method: 'POST', token: t, form: png });
  assert.equal(r.status, 200); assert.equal(r.body.data.mode, 'demo'); assert.equal(r.body.data.uncertain, true);
  assert.match(r.body.data.message, /DEMO/);
});

test('request lifecycle, authorization and analytics', async () => {
  const a = (await call('/auth/register', { method: 'POST', json: { name: 'Aaa', email: 'a@test.dev', password: 'password123' } })).body.data.token;
  const b = (await call('/auth/register', { method: 'POST', json: { name: 'Bbb', email: 'b@test.dev', password: 'password123' } })).body.data.token;
  assert.equal((await call('/requests', { method: 'POST', token: a, json: { ...reqBody, quantity: 0 } })).status, 400);
  const c = await call('/requests', { method: 'POST', token: a, json: reqBody });
  assert.equal(c.status, 201); const id = c.body.data.id; assert.match(id, /^ER-/);
  // cross-user access blocked
  assert.equal((await call('/requests/' + id, { token: b })).status, 404);
  assert.equal((await call(`/requests/${id}/cancel`, { method: 'PATCH', token: b })).status, 404);
  assert.equal((await call('/requests', { token: b })).body.data.total, 0);
  // users cannot change status; partner can, invalid jumps rejected
  assert.equal((await call(`/requests/${id}/status`, { method: 'PATCH', token: a, json: { status: 'Accepted' } })).status, 403);
  const p = await login('partner@demo.test', 'Partner@123');
  assert.equal((await call(`/requests/${id}/status`, { method: 'PATCH', token: p, json: { status: 'Completed' } })).status, 409);
  const before = (await call('/analytics/overview', { token: a })).body.data;
  assert.equal(before.pending, 1); assert.equal(before.completed, 0);
  for (const s of ['Accepted', 'Scheduled', 'Collected', 'Completed'])
    assert.equal((await call(`/requests/${id}/status`, { method: 'PATCH', token: p, json: { status: s } })).status, 200);
  const after = (await call('/analytics/overview', { token: a })).body.data;
  assert.equal(after.pending, 0); assert.equal(after.completed, 1); assert.equal(after.estimatedKgCollected, 0.4);
  assert.equal((await call(`/requests/${id}/cancel`, { method: 'PATCH', token: a })).status, 409);
  const h = (await call('/requests/' + id, { token: a })).body.data.history.map((x) => x.status);
  assert.deepEqual(h, ['Submitted', 'Accepted', 'Scheduled', 'Collected', 'Completed']);
  // owner can cancel before collection
  const id2 = (await call('/requests', { method: 'POST', token: a, json: reqBody })).body.data.id;
  assert.equal((await call(`/requests/${id2}/cancel`, { method: 'PATCH', token: a })).status, 200);
});

test('partner queue is prioritised with reasons and separates hazardous', async () => {
  const t = await login('user@demo.test', 'User@1234');
  const r = await call('/requests', { method: 'POST', token: t, json: { ...reqBody, category: 'battery', quantity: 1 } });
  const q = (await call('/admin/requests', { token: await login('partner@demo.test', 'Partner@123') })).body.data;
  const mine = q.find((x) => x.id === r.body.data.id);
  assert.equal(mine.priority.queue, 'specialist'); assert.ok(mine.priority.reasons.length >= 3);
  for (let i = 1; i < q.length; i++) assert.ok(q[i - 1].priority.score >= q[i].priority.score);
});
