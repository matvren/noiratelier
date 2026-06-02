import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'noir.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT,
    email     TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    is_owner  INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    brand       TEXT NOT NULL,
    notes       TEXT,
    description TEXT,
    size        TEXT,
    price       INTEGER NOT NULL,   -- price in cents
    stock       INTEGER DEFAULT 50,
    active      INTEGER DEFAULT 1,
    accent      TEXT DEFAULT '#b8975a',
    image       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

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
  );
`);

// ---- safe migrations for existing databases ----
// add `image` column if an older DB is missing it
const cols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!cols.includes('image')) {
  db.exec("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''");
}

// add shipping columns to orders table if missing (safe migration)
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
const shippingCols = ['shipping_name','shipping_address','shipping_city','shipping_postcode','shipping_country','shipping_phone'];
for (const col of shippingCols) {
  if (!orderCols.includes(col)) {
    db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT DEFAULT ''`);
  }
}

export default db;
