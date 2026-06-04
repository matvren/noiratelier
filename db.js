import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isVercel = !!process.env.VERCEL;
const DB_PATH = isVercel ? '/tmp/noir.db' : path.join(__dirname, 'noir.db').replace(/\\/g, '/');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = 'matvren';
const GH_REPO = 'noiratelier';
const GH_BRANCH = 'db-backup';

let ghSha = null;

async function ghDownload() {
  if (!GITHUB_TOKEN) return 0;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/noir.db?ref=${GH_BRANCH}`;
  // Retry up to 2 times with a 10s timeout (GitHub API can be slow or flaky on Vercel cold starts)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
      });
      clearTimeout(timer);
      if (res.ok) {
        const { content } = await res.json();
        const buf = Buffer.from(content, 'base64');
        if (buf.length > 100) {
          fs.writeFileSync(DB_PATH, buf);
          return 2;
        }
        return 0;
      }
      if (res.status === 404) return 1;
      // non-404 error: retry
      console.warn(`ghDownload attempt ${attempt + 1} failed (${res.status}), retrying…`);
    } catch (e) {
      console.warn(`ghDownload attempt ${attempt + 1} error: ${e.message}, retrying…`);
    }
  }
  return -1;
}

export async function ghUpload() {
  if (!GITHUB_TOKEN) return { ok: false, error: 'No GITHUB_TOKEN set' };
  try {
    const content = fs.readFileSync(DB_PATH).toString('base64');
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/noir.db`;
    const getRes = await fetch(url + `?ref=${GH_BRANCH}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (getRes.ok) ghSha = (await getRes.json()).sha;
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'save noir.db', content, sha: ghSha, branch: GH_BRANCH }),
    });
    if (putRes.ok) {
      ghSha = (await putRes.json()).content.sha;
      return { ok: true };
    }
    const t = await putRes.text();
    return { ok: false, error: `GitHub ${putRes.status}: ${t.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const ghResult = await ghDownload();
if (ghResult === 2) console.log('✓ Restored noir.db from GitHub');
else if (ghResult === 1) console.log('• Starting fresh');
else if (ghResult === -1) console.warn('• GitHub download failed');

const db = createClient({ url: `file:${DB_PATH}` });

// DELETE journal mode so the main file is always up to date (no WAL)
await db.execute('PRAGMA journal_mode=DELETE');
await db.execute('PRAGMA synchronous=NORMAL');

await db.execute(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL, is_owner INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
)`);
await db.execute(`CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, brand TEXT NOT NULL,
  notes TEXT, description TEXT, size TEXT, price INTEGER NOT NULL,
  stock INTEGER DEFAULT 50, active INTEGER DEFAULT 1, accent TEXT DEFAULT '#b8975a',
  image TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
)`);
await db.execute(`CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
)`);
await db.execute(`CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, email TEXT,
  total INTEGER NOT NULL, items_json TEXT, status TEXT DEFAULT 'paid',
  shipping_name TEXT, shipping_address TEXT, shipping_city TEXT,
  shipping_postcode TEXT, shipping_country TEXT, shipping_phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// safe migrations
const pcols = (await db.execute("PRAGMA table_info(products)")).rows.map(c => c.name);
if (!pcols.includes('image')) await db.execute("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''");
const ocols = (await db.execute("PRAGMA table_info(orders)")).rows.map(c => c.name);
for (const col of ['shipping_name','shipping_address','shipping_city','shipping_postcode','shipping_country','shipping_phone']) {
  if (!ocols.includes(col)) await db.execute(`ALTER TABLE orders ADD COLUMN ${col} TEXT DEFAULT ''`);
}
if (!ocols.includes('customer_confirmed')) {
  try { await db.execute('ALTER TABLE orders ADD COLUMN customer_confirmed INTEGER DEFAULT 0'); } catch (e) { /* ignore */ }
}
await db.execute(`CREATE TABLE IF NOT EXISTS newsletter (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

export default db;
