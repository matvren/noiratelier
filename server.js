import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db, { setReady, ghUpload } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '35a746bb03340874a2e54fcafbc017526e5a224e0e9628f910e3ff7a5a8d3a13';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'numbell98@gmail.com').toLowerCase();
const BASE_URL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`);

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

// ---------- helpers ----------
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function euro(cents) { return (cents / 100).toFixed(2); }

function signToken(user) {
  return jwt.sign(
    { id: Number(user.id), email: user.email, is_owner: !!user.is_owner, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authOptional(req, _res, next) {
  const token = req.cookies?.token;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  if (!req.user.is_owner) return res.status(403).json({ error: 'Access denied.' });
  next();
}

app.use(authOptional);

// ---- auto-seed on fresh DB ----
async function autoSeed() {
  const prodCount = (await db.execute('SELECT COUNT(*) AS c FROM products')).rows[0].c;
  if (prodCount === 0) {
    const products = [
      { name: 'Sauvage EDP',            brand: 'Dior',                notes: 'Bergamot · Ambroxan · Vanilla',          size: '100ml', price: 13500, accent: '#5b6e8c', description: 'A radically fresh, raw composition. Bright bergamot meets a powerful woody-ambery trail.' },
      { name: 'Bleu de Chanel EDP',     brand: 'Chanel',              notes: 'Citrus · Cedar · Sandalwood',            size: '100ml', price: 14800, accent: '#2f4a6b', description: 'An aromatic-woody fragrance of timeless elegance and unexpected freshness.' },
      { name: 'Aventus',                brand: 'Creed',               notes: 'Pineapple · Birch · Musk',               size: '100ml', price: 39500, accent: '#8a8f98', description: 'The iconic fruity-smoky signature. Bold, confident and unmistakable.' },
      { name: 'Oud Wood',               brand: 'Tom Ford',            notes: 'Oud · Rosewood · Cardamom',              size: '50ml',  price: 27500, accent: '#6b4a2f', description: 'Rare oud wood smoothed by warm spice and a creamy, smoky finish.' },
      { name: 'Black Orchid',          brand: 'Tom Ford',            notes: 'Truffle · Black Orchid · Patchouli',     size: '100ml', price: 16500, accent: '#3a2b4a', description: 'A luxurious, sensual fragrance of rich dark accords and an alluring potion of black orchids.' },
      { name: "La Nuit de L'Homme",    brand: 'Yves Saint Laurent',  notes: 'Cardamom · Lavender · Cedar',            size: '100ml', price: 11500, accent: '#1f1f24', description: 'Seductive and refined. A magnetic contrast of fresh spice and warm woods.' },
      { name: 'Acqua di Giò Profumo',   brand: 'Giorgio Armani',      notes: 'Marine · Incense · Patchouli',           size: '75ml',  price: 12500, accent: '#3d5a6b', description: 'A deep aquatic with smoky incense — the sea at dusk in a bottle.' },
      { name: 'Tobacco Vanille',        brand: 'Tom Ford',            notes: 'Tobacco · Vanilla · Tonka',              size: '50ml',  price: 28500, accent: '#7a5230', description: 'Opulent and warm. Smooth tobacco leaf wrapped in spice and creamy vanilla.' },
      { name: 'Y EDP',                  brand: 'Yves Saint Laurent',  notes: 'Apple · Sage · Amberwood',               size: '100ml', price: 12000, accent: '#2b3a4a', description: 'Fresh, bold and modern — a clean signature with a magnetic woody base.' },
      { name: 'Spicebomb Extreme',      brand: 'Viktor & Rolf',       notes: 'Tobacco · Cinnamon · Vanilla',           size: '90ml',  price: 11800, accent: '#5a2b2b', description: 'An explosive blend of warm spice and creamy tobacco. Cold-weather perfection.' },
      { name: 'The One EDP',            brand: 'Dolce & Gabbana',     notes: 'Tobacco · Ginger · Amber',               size: '100ml', price: 10500, accent: '#6b5230', description: 'A warm, elegant oriental — refined spice over a smooth amber heart.' },
      { name: 'Eros EDT',               brand: 'Versace',             notes: 'Mint · Tonka · Vanilla',                 size: '100ml', price: 9500,  accent: '#2f5a6b', description: 'Fresh, glacial mint over a sweet, addictive base. Vibrant and bold.' },
      { name: 'Layton',                 brand: 'Parfums de Marly',    notes: 'Apple · Lavender · Vanilla',             size: '125ml', price: 27000, accent: '#3a3f5a', description: 'A modern crowd-pleaser — bright apple and lavender melting into creamy vanilla.' },
      { name: 'Baccarat Rouge 540',     brand: 'Maison Francis K.',   notes: 'Saffron · Jasmine · Amberwood',          size: '70ml',  price: 32500, accent: '#8a3a3a', description: 'Luminous and ethereal. An amber-floral signature that lingers like light on crystal.' },
      { name: 'Reflection Man',         brand: 'Amouage',             notes: 'Rosemary · Jasmine · Sandalwood',        size: '100ml', price: 31500, accent: '#4a5a4a', description: 'A polished floral-woody — clean, sophisticated and endlessly wearable.' },
      { name: 'Interlude Man',          brand: 'Amouage',             notes: 'Oregano · Incense · Leather',            size: '100ml', price: 33500, accent: '#5a4a2f', description: 'Smoky, resinous and intense — a controlled chaos of incense and spice.' },
      { name: 'Erba Pura',              brand: 'Xerjoff',             notes: 'Fruit · Vanilla · Musk',                 size: '100ml', price: 24500, accent: '#8a6b2f', description: 'A radiant fruity-amber. Sweet, juicy and luxuriously long-lasting.' },
      { name: "Ombré Leather",          brand: 'Tom Ford',            notes: 'Leather · Jasmine · Patchouli',          size: '100ml', price: 17500, accent: '#5a3a2b', description: 'Soft, supple leather with a floral edge. Raw, warm and effortlessly cool.' },
      { name: 'Grand Soir',             brand: 'Maison Francis K.',   notes: 'Amber · Vanilla · Benzoin',              size: '70ml',  price: 26500, accent: '#7a5a2f', description: 'A golden amber glow — warm, smooth and quietly luxurious for the evening.' },
      { name: 'Fucking Fabulous',       brand: 'Tom Ford',            notes: 'Almond · Leather · Tonka',               size: '50ml',  price: 29500, accent: '#3a2f2b', description: 'A daring leather-amber with creamy almond and bitter herbs. Provocative and unique.' },
    ];
    await db.execute('BEGIN');
    try {
      for (let idx = 0; idx < products.length; idx++) {
        const r = products[idx];
        const image = idx < 10 ? `/images/${idx + 1}.png` : '';
        await db.execute({
          sql: `INSERT INTO products (name, brand, notes, description, size, price, stock, accent, image) VALUES (?, ?, ?, ?, ?, ?, 50, ?, ?)`,
          args: [r.name, r.brand, r.notes, r.description, r.size, r.price, r.accent, image],
        });
      }
      await db.execute('COMMIT');
      console.log(`✓ Auto-seeded ${products.length} fragrances.`);
    } catch (e) {
      await db.execute('ROLLBACK');
      console.error('Auto-seed failed:', e.message);
    }
  } else {
    console.log(`• Products exist (${prodCount}). Skipping seed.`);
  }

  const ownerEmail = OWNER_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD || 'sideeffectS!17173639';
  const hash = bcrypt.hashSync(adminPass, 10);
  const existing = (await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [ownerEmail] })).rows[0];
  if (!existing) {
    await db.execute({
      sql: 'INSERT INTO users (name, email, password, is_owner) VALUES (?, ?, ?, 1)',
      args: ['Owner', ownerEmail, hash],
    });
    console.log(`✓ Created owner account: ${ownerEmail}`);
  } else {
    await db.execute({ sql: 'UPDATE users SET password = ?, is_owner = 1 WHERE email = ?', args: [hash, ownerEmail] });
    console.log(`• Updated owner password for ${ownerEmail}`);
  }
  console.log(`  Owner login: ${ownerEmail} / ${adminPass}  (set ADMIN_PASSWORD env var to customise)`);
}
await autoSeed();
setReady();
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  ghUpload().catch(() => {});
}

// setup mail helper
let mailer = null;
async function getMailer() {
  if (mailer) return mailer;
  const host = process.env.SMTP_HOST;
  if (host && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1' || false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return mailer;
  }
  try {
    const testAccount = await nodemailer.createTestAccount();
    mailer = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('Using Ethereal test SMTP account. Preview emails in server logs.');
    return mailer;
  } catch (err) {
    console.warn('Could not create test mail account:', err && err.message);
    return null;
  }
}

async function sendOrderEmail(orderId, status, orderData) {
  try {
    const transport = await getMailer();
    if (!transport) return;
    const to = process.env.OWNER_EMAIL || OWNER_EMAIL;
    const subject = `New order #${orderId} — ${status}`;
    const items = (orderData.items_json ? JSON.parse(orderData.items_json) : (orderData.items || [])).map(i => `${i.qty}× ${i.brand} ${i.name} — €${euro(i.price * i.qty)}`).join('\n');
    const text = `Order #${orderId}\nStatus: ${status}\nTotal: €${euro(orderData.total || 0)}\n\nItems:\n${items}\n\nShip to:\n${orderData.shipping_name || ''}\n${orderData.shipping_address || ''}\n${orderData.shipping_city || ''} ${orderData.shipping_postcode || ''}\n${orderData.shipping_country || ''}\n${orderData.shipping_phone || ''}\n\nView admin: ${BASE_URL}/#/admin`;
    const info = await transport.sendMail({ from: `NOIR ATELIER <no-reply@noir-atelier.local>`, to, subject, text });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log('Email preview URL:', preview);
    console.log('Order email sent for order', orderId);
  } catch (err) {
    console.error('sendOrderEmail error:', err && err.message);
  }
}

// ---------- public config ----------
app.get('/api/config', asyncHandler(async (req, res) => {
  const base = { user: req.user ? { name: req.user.name, email: req.user.email, is_owner: req.user.is_owner } : null };
  try {
    if (req.user && req.user.is_owner) {
      const row = (await db.execute("SELECT COUNT(*) AS c FROM orders WHERE customer_confirmed = 1 AND status != 'paid'")).rows[0];
      base.pending_orders_count = row ? row.c : 0;
    }
  } catch (e) { base.pending_orders_count = 0; }
  res.json(base);
}));

// ---------- auth ----------
app.post('/api/signup', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const e = email.toLowerCase().trim();
  const exists = (await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [e] })).rows[0];
  if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, 10);
  const isOwner = e === OWNER_EMAIL ? 1 : 0;
  const result = await db.execute({
    sql: 'INSERT INTO users (name, email, password, is_owner) VALUES (?, ?, ?, ?)',
    args: [name || 'Guest', e, hash, isOwner],
  });
  const user = { id: Number(result.lastInsertRowid), email: e, is_owner: isOwner, name: name || 'Guest' };
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ user: { name: user.name, email: user.email, is_owner: !!user.is_owner } });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const e = email.toLowerCase().trim();
  const user = (await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [e] })).rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (e === OWNER_EMAIL && !user.is_owner) {
    await db.execute({ sql: 'UPDATE users SET is_owner = 1 WHERE id = ?', args: [user.id] });
    user.is_owner = 1;
  }
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ user: { name: user.name, email: user.email, is_owner: !!user.is_owner } });
}));

app.post('/api/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ---------- products ----------
app.get('/api/products', asyncHandler(async (_req, res) => {
  const rows = (await db.execute('SELECT * FROM products WHERE active = 1 ORDER BY id ASC')).rows;
  res.json(rows);
}));

app.get('/api/admin/products', requireOwner, asyncHandler(async (_req, res) => {
  const rows = (await db.execute('SELECT * FROM products ORDER BY id ASC')).rows;
  res.json(rows);
}));

app.post('/api/admin/products', requireOwner, asyncHandler(async (req, res) => {
  const { name, brand, notes, description, size, price, stock, accent, image } = req.body || {};
  if (!name || !brand || price == null) return res.status(400).json({ error: 'Name, brand and price required.' });
  const result = await db.execute({
    sql: `INSERT INTO products (name, brand, notes, description, size, price, stock, accent, image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [name, brand, notes || '', description || '', size || '', Math.round(price), stock ?? 50, accent || '#b8975a', image || ''],
  });
  const row = (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [Number(result.lastInsertRowid)] })).rows[0];
  res.json(row);
}));

app.put('/api/admin/products/:id', requireOwner, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const p = (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];
  if (!p) return res.status(404).json({ error: 'Not found.' });
  const f = req.body || {};
  await db.execute({
    sql: 'UPDATE products SET name=?, brand=?, notes=?, description=?, size=?, price=?, stock=?, accent=?, image=?, active=? WHERE id=?',
    args: [
      f.name ?? p.name,
      f.brand ?? p.brand,
      f.notes ?? p.notes,
      f.description ?? p.description,
      f.size ?? p.size,
      f.price != null ? Math.round(f.price) : p.price,
      f.stock != null ? f.stock : p.stock,
      f.accent ?? p.accent,
      f.image ?? p.image,
      f.active != null ? (f.active ? 1 : 0) : p.active,
      id,
    ],
  });
  const row = (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];
  res.json(row);
}));

app.delete('/api/admin/products/:id', requireOwner, asyncHandler(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [+req.params.id] });
  res.json({ ok: true });
}));

// owner: upload a base64 data URL image and store it in the DB (persists on Turso)
app.post('/api/admin/products/:id/image', requireOwner, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const p = (await db.execute({ sql: 'SELECT id FROM products WHERE id = ?', args: [id] })).rows[0];
  if (!p) return res.status(404).json({ error: 'Product not found.' });

  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'No image data received.' });

  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|avif);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Please upload a PNG, JPG, WEBP or AVIF image.' });

  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 8MB).' });

  // store the data URL directly in the DB so it persists across restarts
  await db.execute({ sql: 'UPDATE products SET image = ? WHERE id = ?', args: [dataUrl, id] });
  const row = (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];
  res.json(row);
}));

// owner: import an image by URL. Stores the URL directly (no local file).
app.post('/api/admin/products/:id/image-url', requireOwner, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const p = (await db.execute({ sql: 'SELECT id FROM products WHERE id = ?', args: [id] })).rows[0];
  if (!p) return res.status(404).json({ error: 'Product not found.' });

  let { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'No image URL received.' });
  url = url.trim();

  if (!/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Please provide a valid http(s) or data image URL.' });
  }

  await db.execute({ sql: 'UPDATE products SET image = ? WHERE id = ?', args: [url, id] });
  const row = (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];
  res.json(row);
}));

// ---------- cart ----------
async function getCart(userId) {
  return (await db.execute({
    sql: `SELECT ci.product_id AS id, ci.qty, p.name, p.brand, p.price, p.size, p.accent, p.image
      FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = ? ORDER BY ci.id ASC`,
    args: [userId],
  })).rows;
}

app.get('/api/cart', requireAuth, asyncHandler(async (req, res) => {
  res.json(await getCart(req.user.id));
}));

app.post('/api/cart', requireAuth, asyncHandler(async (req, res) => {
  const { product_id, qty = 1 } = req.body || {};
  const p = (await db.execute({ sql: 'SELECT id FROM products WHERE id = ?', args: [product_id] })).rows[0];
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  await db.execute({
    sql: `INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)
      ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + excluded.qty`,
    args: [req.user.id, product_id, Math.max(1, qty)],
  });
  res.json(await getCart(req.user.id));
}));

app.put('/api/cart/:id', requireAuth, asyncHandler(async (req, res) => {
  const qty = Math.max(0, +req.body.qty || 0);
  if (qty === 0) {
    await db.execute({ sql: 'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', args: [req.user.id, +req.params.id] });
  } else {
    await db.execute({ sql: 'UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?', args: [qty, req.user.id, +req.params.id] });
  }
  res.json(await getCart(req.user.id));
}));

app.delete('/api/cart/:id', requireAuth, asyncHandler(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', args: [req.user.id, +req.params.id] });
  res.json(await getCart(req.user.id));
}));

// ---------- orders ----------
app.post('/api/order/create', requireAuth, asyncHandler(async (req, res) => {
  const cart = await getCart(req.user.id);
  if (!cart.length) return res.status(400).json({ error: 'Your cart is empty.' });
  const { draft_id } = req.body || {};
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  if (draft_id) {
    const d = (await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = ?', args: [draft_id, req.user.id, 'address'] })).rows[0];
    if (!d) return res.status(404).json({ error: 'Draft not found.' });
    await db.execute({ sql: `UPDATE orders SET total = ?, items_json = ?, status = 'pending' WHERE id = ?`, args: [total, JSON.stringify(cart), draft_id] });
    await db.execute({ sql: 'DELETE FROM cart_items WHERE user_id = ?', args: [req.user.id] });
    return res.json({ ok: true, order_id: Number(draft_id) });
  }
  const { name, address, city, postcode, country, phone } = req.body || {};
  if (!name || !address || !city || !postcode || !country) return res.status(400).json({ error: 'Please provide full shipping details.' });
  const result = await db.execute({
    sql: `INSERT INTO orders (user_id, email, total, items_json, status, shipping_name, shipping_address, shipping_city, shipping_postcode, shipping_country, shipping_phone)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    args: [req.user.id, req.user.email, total, JSON.stringify(cart), name, address, city, postcode, country, phone || ''],
  });
  await db.execute({ sql: 'DELETE FROM cart_items WHERE user_id = ?', args: [req.user.id] });
  res.json({ ok: true, order_id: Number(result.lastInsertRowid) });
}));

app.post('/api/admin/orders/:id/paid', requireOwner, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const o = (await db.execute({ sql: 'SELECT id FROM orders WHERE id = ?', args: [id] })).rows[0];
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  await db.execute({ sql: 'UPDATE orders SET status = ? WHERE id = ?', args: ['paid', id] });
  res.json({ ok: true });
}));

app.post('/api/admin/orders/:id/pending', requireOwner, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const o = (await db.execute({ sql: 'SELECT id FROM orders WHERE id = ?', args: [id] })).rows[0];
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  await db.execute({ sql: 'UPDATE orders SET status = ? WHERE id = ?', args: ['pending', id] });
  res.json({ ok: true });
}));

app.delete('/api/admin/orders/:id', requireOwner, asyncHandler(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [+req.params.id] });
  res.json({ ok: true });
}));

app.get('/api/order/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const o = (await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND user_id = ?', args: [id, req.user.id] })).rows[0];
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(o);
}));

app.post('/api/order/:id/notify-paid', requireAuth, asyncHandler(async (req, res) => {
  const id = +req.params.id;
  const o = (await db.execute({ sql: 'SELECT id FROM orders WHERE id = ? AND user_id = ?', args: [id, req.user.id] })).rows[0];
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  await db.execute({ sql: 'UPDATE orders SET customer_confirmed = 1 WHERE id = ?', args: [id] });
  try {
    const orderRow = (await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] })).rows[0];
    sendOrderEmail(id, 'customer_confirmed', orderRow);
  } catch (e) { /* ignore */ }
  res.json({ ok: true });
}));

app.get('/api/admin/orders', requireOwner, asyncHandler(async (_req, res) => {
  const rows = (await db.execute('SELECT * FROM orders ORDER BY id DESC LIMIT 200')).rows;
  res.json(rows);
}));

// ---------- static ----------
const publicDir = path.join(__dirname, 'public');
const indexPath = path.join(publicDir, 'index.html');

app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  if (!fs.existsSync(indexPath)) {
    console.error('index.html NOT FOUND at:', indexPath);
    console.error('publicDir contents:', fs.readdirSync(publicDir));
    return res.status(200).send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>NOIR ATELIER</title></head><body style="background:#0a0a0b;color:#e5dcca;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:300;letter-spacing:0.2em">NOIR ATELIER</h1><p style="color:#b8975a">Loading…</p></div></body></html>');
  }
  res.sendFile(indexPath);
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(PORT, process.env.HOST || process.env.IP || '0.0.0.0', () => {
    console.log(`\n  NOIR ATELIER running → ${BASE_URL}`);
    console.log(`  DB: file:noir.db${process.env.GITHUB_TOKEN ? ' + GitHub sync' : ' (local only)'}`);
    console.log(`  Owner email: ${OWNER_EMAIL}\n`);
  });
}

export default app;