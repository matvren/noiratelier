import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'noir.db');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = 'matvren';
const GH_REPO = 'noiratelier';

// ---- GitHub sync helpers ----
async function ghDownload() {
  if (!GITHUB_TOKEN) return 0;
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/noir.db`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (res.ok) {
    const { content } = await res.json();
    fs.writeFileSync(DB_PATH, Buffer.from(content, 'base64'));
    return 2;
  }
  if (res.status === 404) return 1;
  return -1;
}

let ghSha = null;
export async function ghUpload() {
  if (!GITHUB_TOKEN) return;
  try {
    const content = fs.readFileSync(DB_PATH).toString('base64');
    const getRes = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/noir.db`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (getRes.ok) ghSha = (await getRes.json()).sha;
    const putRes = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/noir.db`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'auto sync noir.db', content, sha: ghSha }),
      }
    );
    if (putRes.ok) { ghSha = (await putRes.json()).content.sha; console.log('✓ Synced noir.db to GitHub'); }
    else { const t = await putRes.text(); console.error('× GitHub sync error:', putRes.status, t.slice(0, 200)); }
  } catch (e) { console.error('× GitHub sync:', e.message); }
}

// Restore DB from GitHub on startup
const ghResult = await ghDownload();
if (ghResult === 2) console.log('✓ Restored noir.db from GitHub');
else if (ghResult === 1) console.log('• Starting fresh - no noir.db on GitHub yet');
else if (ghResult === -1) console.warn('• GitHub download failed');
else console.log('• No GITHUB_TOKEN set, using local file');

const db = createClient({ url: `file:${DB_PATH}` });

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

// Auto-sync after writes
let ready = false;
const _exec = db.execute.bind(db);
db.execute = async function (input) {
  const result = await _exec(input);
  if (ready) {
    const sql = typeof input === 'string' ? input : input.sql;
    if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql.trim())) {
      setImmediate(() => ghUpload().catch(() => {}));
    }
  }
  return result;
};

export function setReady() { ready = true; }
export default db;