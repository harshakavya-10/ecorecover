import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const file = process.env.DB_PATH || './data/ecorecover.db';
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);

db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','partner','admin')) DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT, confidence REAL, mode TEXT NOT NULL, image_key TEXT, image_mime TEXT, image_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL, ai_category TEXT, classification_id INTEGER REFERENCES classifications(id),
  condition TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  mode TEXT NOT NULL CHECK (mode IN ('pickup','dropoff')),
  city TEXT NOT NULL, locality TEXT NOT NULL, notes TEXT, hazardous INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Submitted', is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES requests(id),
  status TEXT NOT NULL, changed_by INTEGER REFERENCES users(id), note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_req_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_req_locality ON requests(locality);
CREATE INDEX IF NOT EXISTS idx_hist_req ON status_history(request_id);
`);

export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const add = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
  add.run('Demo Admin', 'admin@demo.test', bcrypt.hashSync('Admin@123', 10), 'admin');
  add.run('Demo Partner (sample, unverified)', 'partner@demo.test', bcrypt.hashSync('Partner@123', 10), 'partner');
  const uid = Number(add.run('Demo Citizen', 'user@demo.test', bcrypt.hashSync('User@1234', 10), 'user').lastInsertRowid);

  const cats = ['mobile_phone', 'laptop', 'charger', 'cable', 'circuit_board', 'battery', 'mobile_phone', 'charger'];
  const places = [['Mumbai', 'Andheri'], ['Mumbai', 'Bandra'], ['Mumbai', 'Powai'], ['Mumbai', 'Dadar'], ['Thane', 'Thane West']];
  const conds = ['non_functional', 'repairable', 'working', 'non_functional'];
  const flow = ['Submitted', 'Accepted', 'Scheduled', 'Collected', 'Completed'];
  const insR = db.prepare(`INSERT INTO requests (id,user_id,category,condition,quantity,mode,city,locality,hazardous,status,is_sample,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`);
  const insH = db.prepare('INSERT INTO status_history (request_id,status,created_at) VALUES (?,?,?)');
  const DAY = 864e5;
  for (let i = 0; i < 30; i++) {
    const created = new Date(Date.now() - ((i * 1.7) % 50) * DAY - 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const cat = cats[i % cats.length], [city, loc] = places[i % places.length];
    const status = i % 11 === 0 ? 'Cancelled' : flow[(i * 3) % 5];
    const id = `ER-SAMPL${String(i).padStart(2, '0')}`;
    insR.run(id, uid, cat, conds[i % 4], 1 + (i % 4), i % 3 ? 'pickup' : 'dropoff', city, loc, cat === 'battery' ? 1 : 0, status, created, created);
    insH.run(id, 'Submitted', created);
    if (status !== 'Submitted') insH.run(id, status, created);
  }
}
