// Password for the local interface (optional). Only the salt and the hash (scrypt) are stored in .library-auth.json, which is outside git.
// Sessions live in the memory of the server: after a restart you sign in again. Forgotten password: stop the app and delete the file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';

const FILE = path.join(ROOT, '.library-auth.json');
const COOKIE = 'library_session';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1024;

const sessions = new Map(); // hash of the cookie -> when it expires
let fails = 0;
let lockedUntil = 0;

const stored = () => { try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); return a?.hash && a?.salt ? a : null; } catch { return null; } };
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('hex');
const derive = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key)));
});

export const authEnabled = () => !!stored();
export const isLocked = () => Date.now() < lockedUntil;

/** Checks the password. After a few wrong attempts the checks stop for a minute. */
export async function verifyPassword(password) {
  const a = stored();
  if (!a || isLocked() || typeof password !== 'string' || password.length > MAX_PASSWORD) return false;
  const ok = crypto.timingSafeEqual(await derive(password, a.salt), Buffer.from(a.hash, 'hex'));
  if (ok) { fails = 0; return true; }
  if (++fails >= MAX_FAILS) { fails = 0; lockedUntil = Date.now() + LOCK_MS; }
  return false;
}

/** Sets a new password. All old sessions stop being valid. */
export async function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await derive(password, salt)).toString('hex');
  fs.writeFileSync(FILE, JSON.stringify({ salt, hash }) + '\n', { mode: 0o600 });
  sessions.clear();
}

export function clearPassword() {
  // In the isolation the file is mounted separately and cannot be deleted; an empty file means the same: no password.
  try { fs.rmSync(FILE, { force: true }); } catch { fs.writeFileSync(FILE, ''); }
  sessions.clear();
}

export const validPassword = (p) => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= MAX_PASSWORD;

function tokenOf(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === COOKIE && v) return v;
  }
  return null;
}

export function hasSession(req) {
  const t = tokenOf(req);
  if (!t) return false;
  const key = tokenKey(t);
  const until = sessions.get(key);
  if (!until) return false;
  if (until < Date.now()) { sessions.delete(key); return false; }
  return true;
}

export function startSession(res) {
  const t = crypto.randomBytes(32).toString('base64url');
  sessions.set(tokenKey(t), Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
}

export function endSession(req, res) {
  const t = tokenOf(req);
  if (t) sessions.delete(tokenKey(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
