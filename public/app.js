const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = localStorage.getItem('token'), me = JSON.parse(localStorage.getItem('user') || 'null'), cats = [], draft = {};
const label = (id) => cats.find((c) => c.id === id)?.label || id;
const COND = { working: 'Working', repairable: 'Repairable', non_functional: 'Not working' };

async function api(path, opts = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let body = opts.form;
  if (opts.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
  let res;
  try { res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body }); }
  catch { throw new Error('Cannot reach the server. Check your connection.'); }
  const d = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(); throw new Error('Session expired. Please log in again.'); }
  if (!res.ok) throw new Error(d.error || 'Request failed');
  return d.data;
}
function setAuth(d) { token = d.token; me = d.user; localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(me)); }
function logout() { token = me = null; localStorage.removeItem('token'); localStorage.removeItem('user'); location.hash = '#/login'; renderNav(); }
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v)); return p.toString() ? '?' + p : ''; };
const msg = (id, text, good) => { const e = $(id); if (e) e.innerHTML = text ? `<div class="${good ? 'okmsg' : 'err'}" role="${good ? 'status' : 'alert'}">${esc(text)}</div>` : ''; };
const loading = '<p><span class="spin"></span> Loading...</p>';
function bars(rows) {
  if (!rows.length) return '<p class="muted">No data for these filters.</p>';
  const max = Math.max(...rows.map((r) => r.value));
  return rows.map((r) => `<div class="bar"><span>${esc(label(r.label))}</span><i style="width:${(r.value / max) * 60}%"></i><b>${r.value}</b></div>`).join('');
}

// ---------- views ----------
const views = {
  '/': () => ({ html: `<section class="hero"><h1>Know exactly what to do with your old electronics</h1>
    <p>Old phones, chargers and batteries pile up at home or end up in the bin. EcoRecover AI identifies the item from a photo, tells you the safest next step (reuse, repair or collect), and sends a request to a collection partner.</p>
    <a class="btn" href="#/${me ? 'identify' : 'register'}">${me ? 'Identify an item' : 'Get started'}</a></section>
    <h2>How it works</h2><div class="grid">
    <div class="card"><h3>1. Snap</h3><p>Upload a photo. A model suggests a category, and you confirm it.</p></div>
    <div class="card"><h3>2. Get advice</h3><p>Repair or reuse first. Batteries get special, safe-handling guidance.</p></div>
    <div class="card"><h3>3. Request</h3><p>Choose pickup or drop-off by city and locality. Track the status.</p></div>
    <div class="card"><h3>4. Partners prioritise</h3><p>Partners see a transparent priority score with reasons.</p></div></div>`}),

  '/login': () => ({ html: `<h1>Log in</h1><form id="f"><label for="e">Email</label><input id="e" type="email" required autocomplete="email">
    <label for="p">Password</label><input id="p" type="password" required autocomplete="current-password"><div id="m"></div><br><button class="btn">Log in</button></form>
    <p class="muted">Demo accounts: user@demo.test / User@1234, partner@demo.test / Partner@123, admin@demo.test / Admin@123</p>`,
    bind: () => $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { setAuth(await api('/auth/login', { method: 'POST', json: { email: $('#e').value, password: $('#p').value } })); location.hash = me.role === 'user' ? '#/dashboard' : '#/partner'; renderNav(); } catch (e) { msg('#m', e.message); } } }),

  '/register': () => ({ html: `<h1>Create account</h1><form id="f"><label for="n">Name</label><input id="n" required minlength="2" autocomplete="name">
    <label for="e">Email</label><input id="e" type="email" required autocomplete="email"><label for="p">Password (8+ characters)</label><input id="p" type="password" minlength="8" required autocomplete="new-password">
    <div id="m"></div><br><button class="btn">Register</button></form>`,
    bind: () => $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { setAuth(await api('/auth/register', { method: 'POST', json: { name: $('#n').value, email: $('#e').value, password: $('#p').value } })); location.hash = '#/dashboard'; renderNav(); } catch (e) { msg('#m', e.message); } } }),

  '/dashboard': () => ({ auth: true, html: `<h1>Hello, ${esc(me?.name)}</h1><div id="s">${loading}</div>
    <p><a class="btn" href="#/identify">Identify an item</a> <a class="btn alt" href="#/track">My requests</a></p>`,
    bind: async () => { try { const o = await api('/analytics/overview'); $('#s').innerHTML = `<div class="grid">
      <div class="card stat"><b>${o.identified}</b><span>Items identified</span></div><div class="card stat"><b>${o.totalRequests}</b><span>Collection requests</span></div>
      <div class="card stat"><b>${o.pending}</b><span>Pending</span></div><div class="card stat"><b>${o.completed}</b><span>Collected / completed</span></div>
      <div class="card stat"><b>~${o.estimatedKgCollected} kg</b><span>Estimated e-waste collected</span></div></div><p class="muted"><small>${esc(o.assumptions)}</small></p>`; } catch (e) { $('#s').innerHTML = `<div class="err">${esc(e.message)}</div>`; } } }),

  '/identify': () => ({ auth: true, html: `<h1>Identify e-waste</h1><div class="card"><label for="img">Photo of the item (JPEG, PNG or WebP, up to 5 MB)</label>
    <input id="img" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><img id="pv" class="prev" alt="" hidden>
    <div id="m"></div><button id="go" class="btn" disabled>Analyse photo</button> <a href="#/request" class="btn alt" onclick="draft={}">Skip: choose category manually</a></div><div id="res"></div>`,
    bind: () => {
      let file; const types = ['image/jpeg', 'image/png', 'image/webp'];
      $('#img').onchange = (e) => { file = e.target.files[0]; msg('#m', ''); $('#res').innerHTML = ''; $('#go').disabled = true;
        if (!file) return;
        if (!types.includes(file.type)) return msg('#m', 'Please choose a JPEG, PNG or WebP image.');
        if (file.size > 5 * 1024 * 1024) return msg('#m', 'That image is larger than 5 MB.');
        $('#pv').src = URL.createObjectURL(file); $('#pv').hidden = false; $('#go').disabled = false; };
      $('#go').onclick = async () => {
        $('#go').disabled = true; $('#res').innerHTML = loading; const fd = new FormData(); fd.append('image', file);
        try {
          const r = await api('/waste/classify', { method: 'POST', form: fd });
          const opts = cats.map((c) => `<option value="${c.id}" ${c.id === r.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
          $('#res').innerHTML = `<div class="card"><h2>Result</h2>
            ${r.mode === 'demo' ? `<div class="warn-box"><b>Demo mode.</b> ${esc(r.message)}</div>` : ''}
            ${r.mode === 'unavailable' ? `<div class="warn-box">${esc(r.message)}</div>` : ''}
            ${r.mode === 'rekognition' && r.uncertain ? '<div class="warn-box">The model is not sure about this photo. Please check the category yourself.</div>' : ''}
            ${r.category && r.mode !== 'demo' ? `<p>Suggested: <b>${esc(label(r.category))}</b>${r.confidence ? ` (${r.confidence}% confidence)` : ''}</p>` : ''}
            ${r.labels?.length ? `<p class="muted">Model labels: ${esc(r.labels.join(', '))}</p>` : ''}
            <label for="cat">Confirm or change the category</label><select id="cat">${opts}</select>
            <p><button id="ok" class="btn">Confirm and continue</button></p></div>`;
          $('#ok').onclick = () => { draft = { category: $('#cat').value, classification_id: r.id }; location.hash = '#/request'; };
        } catch (e) { $('#res').innerHTML = ''; msg('#m', e.message); } $('#go').disabled = false; };
    } }),

  '/request': () => ({ auth: true, html: `<h1>Request a collection</h1><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><form id="f">
    <label for="cat">Category</label><select id="cat">${cats.map((c) => `<option value="${c.id}" ${c.id === draft.category ? 'selected' : ''}>${esc(c.label)}${c.hazardous ? ' (hazardous)' : ''}</option>`).join('')}</select>
    <label for="cond">Condition</label><select id="cond">${Object.entries(COND).map(([k, v]) => `<option value="${k}" ${k === 'non_functional' ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <div class="row"><div><label for="q">Quantity</label><input id="q" type="number" min="1" max="50" value="1" required></div>
    <div><label for="mode">Method</label><select id="mode"><option value="pickup">Pickup</option><option value="dropoff">Drop-off</option></select></div></div>
    <div class="row"><div><label for="city">City</label><input id="city" required maxlength="80" value="Mumbai"></div><div><label for="loc">Locality</label><input id="loc" required maxlength="80" placeholder="e.g. Andheri"></div></div>
    <label for="notes">Notes (optional)</label><textarea id="notes" maxlength="500" rows="3"></textarea><div id="m"></div><br><button class="btn">Submit request</button></form>
    <div id="rec"></div></div>`,
    bind: () => {
      const showRec = async () => { try { const r = await api('/waste/recommendation' + qs({ category: $('#cat').value, condition: $('#cond').value }));
        $('#rec').innerHTML = `<div class="card"><h2>${esc(r.title)}</h2>${r.hazardous ? '<span class="badge haz">Hazardous: specialist handling</span>' : ''}<ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${r.warnings.map((w) => `<div class="warn-box">${esc(w)}</div>`).join('')}<small class="muted">${esc(r.note)}</small></div>`; } catch (e) { $('#rec').innerHTML = ''; } };
      $('#cat').onchange = $('#cond').onchange = showRec; showRec();
      $('#f').onsubmit = async (ev) => { ev.preventDefault();
        try { const r = await api('/requests', { method: 'POST', json: { category: $('#cat').value, condition: $('#cond').value, quantity: parseInt($('#q').value), mode: $('#mode').value,
          city: $('#city').value, locality: $('#loc').value, notes: $('#notes').value, ...(draft.classification_id && draft.category === $('#cat').value ? { classification_id: draft.classification_id } : {}) } });
          draft = {}; location.hash = '#/track?new=' + r.id; } catch (e) { msg('#m', e.message); } }; } }),

  '/track': () => ({ auth: true, html: `<h1>My requests</h1><div id="n"></div><div id="l">${loading}</div><div id="d"></div>`,
    bind: async () => {
      const fresh = new URLSearchParams(location.hash.split('?')[1] || '').get('new'); if (fresh) msg('#n', `Request submitted. Your request ID is ${fresh}.`, true);
      const load = async () => { try { const { items, total } = await api('/requests?limit=50');
        $('#l').innerHTML = items.length ? `<div class="scroll"><table><thead><tr><th>ID</th><th>Item</th><th>Qty</th><th>Locality</th><th>Status</th><th></th></tr></thead><tbody>${items.map((r) => `<tr><td>${esc(r.id)}${r.is_sample ? ' <small>(sample)</small>' : ''}</td><td>${esc(label(r.category))}${r.hazardous ? ' <span class="badge haz">hazardous</span>' : ''}</td><td>${r.quantity}</td><td>${esc(r.locality)}</td><td><span class="badge ${r.status}">${r.status}</span></td>
          <td><button class="btn sm alt" data-h="${esc(r.id)}">History</button> ${r.next.includes('Cancelled') ? `<button class="btn sm warn" data-c="${esc(r.id)}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div><small class="muted">${total} request(s)</small>`
          : '<p>No requests yet. <a href="#/identify">Identify an item</a> to start.</p>';
        document.querySelectorAll('[data-h]').forEach((b) => b.onclick = async () => { const r = await api('/requests/' + b.dataset.h);
          $('#d').innerHTML = `<div class="card"><h3>${esc(r.id)} history</h3><ol>${r.history.map((h) => `<li>${esc(h.status)} <small class="muted">${esc(h.created_at)} UTC</small></li>`).join('')}</ol></div>`; });
        document.querySelectorAll('[data-c]').forEach((b) => b.onclick = async () => { if (!confirm('Cancel this request?')) return;
          try { await api(`/requests/${b.dataset.c}/cancel`, { method: 'PATCH' }); load(); } catch (e) { msg('#n', e.message); } });
      } catch (e) { $('#l').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
      load(); } }),

  '/analytics': () => ({ auth: true, html: `<h1>Analytics</h1><form id="f" class="row" style="max-width:none"><div><label for="from">From</label><input type="date" id="from"></div><div><label for="to">To</label><input type="date" id="to"></div>
    <div><label for="cat">Category</label><select id="cat"><option value="">All</option>${cats.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></div>
    <div><label for="loc">Locality</label><input id="loc" placeholder="exact name"></div></form><p><button id="ap" class="btn">Apply filters</button></p><div id="o">${loading}</div>`,
    bind: () => { const run = async () => { const q = qs({ from: $('#from').value, to: $('#to').value, category: $('#cat').value, locality: $('#loc').value.trim() });
      try { const [o, c, t, l] = await Promise.all(['overview', 'categories', 'trends', 'localities'].map((k) => api('/analytics/' + k + q)));
        $('#o').innerHTML = `<div class="grid"><div class="card stat"><b>${o.identified}</b><span>Items identified</span></div><div class="card stat"><b>${o.totalRequests}</b><span>Requests</span></div>
          <div class="card stat"><b>${o.pending}</b><span>Pending</span></div><div class="card stat"><b>${o.completed}</b><span>Collected / completed</span></div>
          <div class="card stat"><b>~${o.estimatedKgRequested} kg</b><span>Estimated requested (not cancelled)</span></div><div class="card stat"><b>~${o.estimatedKgCollected} kg</b><span>Estimated collected</span></div></div>
          <p class="warn-box"><small>${esc(o.assumptions)}</small></p>
          <div class="grid"><div class="card"><h3>By category</h3>${bars(c)}</div><div class="card"><h3>By locality</h3>${bars(l)}</div><div class="card"><h3>Weekly trend</h3>${bars(t)}</div></div>`;
      } catch (e) { $('#o').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
      $('#ap').onclick = run; $('#f').onsubmit = (e) => { e.preventDefault(); run(); }; run(); } }),

  '/partner': () => ({ auth: ['partner', 'admin'], html: `<h1>Collection queue</h1><p class="muted">Ranked by a transparent score (waiting time + quantity + hazard flag). Weights are configurable on the server. Not a validated prediction model.</p><div id="n"></div><div id="l">${loading}</div>${me?.role === 'admin' ? '<h2>Partners</h2><div id="p"></div>' : ''}`,
    bind: async () => {
      const load = async () => { try { const rows = await api('/admin/requests'); const sec = (title, list) => `<h2>${title} (${list.length})</h2>${list.length ? `<div class="scroll"><table><thead><tr><th>Score</th><th>Request</th><th>Where</th><th>Why this rank</th><th>Action</th></tr></thead><tbody>${list.map((r) => `<tr><td><b>${r.priority.score}</b></td>
          <td>${esc(r.id)}${r.is_sample ? ' <small>(sample)</small>' : ''}<br>${esc(label(r.category))} x${r.quantity}<br><span class="badge">${r.status}</span> <small>${esc(COND[r.condition])}, ${r.mode}</small></td><td>${esc(r.locality)}, ${esc(r.city)}</td>
          <td><small>${r.priority.reasons.map(esc).join('<br>')}</small></td><td>${r.next.map((s) => `<button class="btn sm ${s === 'Cancelled' ? 'warn' : ''}" data-id="${esc(r.id)}" data-s="${s}">${s}</button>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">None.</p>'}`;
        $('#l').innerHTML = sec('Specialist handling (hazardous)', rows.filter((r) => r.priority.queue === 'specialist')) + sec('Routine pickups', rows.filter((r) => r.priority.queue === 'routine'));
        document.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => { try { await api(`/requests/${b.dataset.id}/status`, { method: 'PATCH', json: { status: b.dataset.s } }); load(); } catch (e) { msg('#n', e.message); } });
      } catch (e) { $('#l').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
      load();
      if (me?.role === 'admin') api('/admin/partners').then((p) => $('#p').innerHTML = `<table><tr><th>Name</th><th>Email</th><th>Status updates</th></tr>${p.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${x.updates}</td></tr>`).join('')}</table><small class="muted">Slot management is not available in this MVP.</small>`).catch(() => {}); } }),

  '/about': () => ({ html: `<h1>About &amp; contact</h1><div class="card"><p>EcoRecover AI is a hackathon MVP for the Waste &amp; Energy track. It helps households decide between reuse, repair and responsible collection of electronics, and helps collectors prioritise pickups.</p>
    <p><b>Honest limits:</b> the demo uses sample data; collection partners shown are unverified demo entries; environmental figures are estimates from stated assumptions, not verified recycling.</p>
    <p><b>Contact:</b> this demo has no live support inbox. Add your team email here before publishing.</p></div>` }),
};

function renderNav() {
  const l = (h, t) => `<a href="#${h}" class="${location.hash.split('?')[0] === '#' + h ? 'on' : ''}">${t}</a>`;
  $('#nav').innerHTML = `<a class="brand" href="#/">EcoRecover AI</a>` + (me
    ? (me.role === 'user' ? l('/dashboard', 'Dashboard') + l('/identify', 'Identify') + l('/request', 'Request') + l('/track', 'My requests') : l('/partner', 'Queue'))
      + l('/analytics', 'Analytics') + l('/about', 'About') + `<button id="lo">Log out (${esc(me.name.split(' ')[0])})</button>`
    : l('/about', 'About') + l('/login', 'Log in') + l('/register', 'Register'));
  if ($('#lo')) $('#lo').onclick = logout;
}
async function route() {
  const path = location.hash.slice(1).split('?')[0] || '/';
  const v = (views[path] || views['/'])();
  if (v.auth && !me) { location.hash = '#/login'; return; }
  if (Array.isArray(v.auth) && !v.auth.includes(me.role)) { $('#app').innerHTML = '<div class="err">You do not have access to this page.</div>'; return; }
  if (!cats.length) try { cats = await api('/waste/categories'); } catch {}
  const w = (views[path] || views['/'])(); // re-render so category list is available to templates
  renderNav(); $('#app').innerHTML = w.html; $('#app').focus(); if (w.bind) w.bind();
}
addEventListener('hashchange', route); route();
