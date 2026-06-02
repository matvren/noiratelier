import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TURSO_DB_URL = process.env.TURSO_DB_URL || `file:${path.join(__dirname, 'noir.db')}`;
const TURSO_DB_TOKEN = process.env.TURSO_DB_TOKEN || '';

const db = createClient({
  url: TURSO_DB_URL,
  authToken: TURSO_DB_TOKEN || undefined,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT,
    email     TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    is_owner  INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    brand       TEXT NOT NULL,
    notes       TEXT,
    description TEXT,
    size        TEXT,
    price       INTEGER NOT NULL,
    stock       INTEGER DEFAULT 50,
    active      INTEGER DEFAULT 1,
    accent      TEXT DEFAULT '#b8975a',
    image       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS cart_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    email       TEXT,
    total       INTEGER NOT NULL,
    items_json  TEXT,
    status      TEXT DEFAULT 'paid',
    shipping_name TEXT,
    shipping_address TEXT,
    shipping_city TEXT,
    shipping_postcode TEXT,
    shipping_country TEXT,
    shipping_phone TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  )
`);

// safe migrations for existing databases
const cols = (await db.execute("PRAGMA table_info(products)")).rows.map((c) => c.name);
if (!cols.includes('image')) {
  await db.execute("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''");
}

const orderCols = (await db.execute("PRAGMA table_info(orders)")).rows.map((c) => c.name);
const shippingCols = ['shipping_name','shipping_address','shipping_city','shipping_postcode','shipping_country','shipping_phone'];
for (const col of shippingCols) {
  if (!orderCols.includes(col)) {
    await db.execute(`ALTER TABLE orders ADD COLUMN ${col} TEXT DEFAULT ''`);
  }
}
if (!orderCols.includes('customer_confirmed')) {
  try { await db.execute('ALTER TABLE orders ADD COLUMN customer_confirmed INTEGER DEFAULT 0'); } catch (e) { /* ignore */ }
}

export default db;
