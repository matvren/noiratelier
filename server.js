import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
// Stripe removed — using manual payment flow and "I've paid" notifications
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '35a746bb03340874a2e54fcafbc017526e5a224e0e9628f910e3ff7a5a8d3a13';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'numbell98@gmail.com').toLowerCase();
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Stripe removed from the codebase. Manual payments (Revolut/PayPal/WhatsApp) are used instead.

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

// ---------- helpers ----------
function euro(cents) { return (cents / 100).toFixed(2); }

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_owner: !!user.is_owner, name: user.name },
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
  if (!req.user.is_owner) return res.status(403).json({ error: 'Owner access only.' });
  next();
}

app.use(authOptional);

// Ensure shipping columns exist on the orders table at runtime (extra safety)
function ensureOrderCols() {
  try {
    const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
    const shippingCols = ['shipping_name','shipping_address','shipping_city','shipping_postcode','shipping_country','shipping_phone'];
for (const col of shippingCols) {
  if (!orderCols.includes(col)) {
    db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT DEFAULT ''`);
  }
}
if (!orderCols.includes('customer_confirmed')) {
  try { db.exec('ALTER TABLE orders ADD COLUMN customer_confirmed INTEGER DEFAULT 0'); } catch (e) { /* ignore */ }
}
  } catch (err) {
    console.error('ensureOrderCols error:', err && err.message);
  }
}

// run migration on startup
ensureOrderCols();
console.log('orders table after ensure:', db.prepare("PRAGMA table_info(orders)").all().map(c => c.name));

// setup mail helper (uses SMTP if provided via env, otherwise Ethereal test account)
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
  // fallback to Ethereal for development/testing
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
    // If using Ethereal, log preview URL
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log('Email preview URL:', preview);
    console.log('Order email sent for order', orderId);
  } catch (err) {
    console.error('sendOrderEmail error:', err && err.message);
  }
}

// ---------- public config ----------
app.get('/api/config', (req, res) => {
  const base = { user: req.user ? { name: req.user.name, email: req.user.email, is_owner: req.user.is_owner } : null };
  try {
    if (req.user && req.user.is_owner) {
      // Count orders where the customer already clicked "I've paid" but the order is not yet marked paid by owner
      const row = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE customer_confirmed = 1 AND status != 'paid'").get();
      base.pending_orders_count = row ? row.c : 0;
    }
  } catch (e) { base.pending_orders_count = 0; }
  res.json(base);
});

// ---------- auth ----------
app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const e = email.toLowerCase().trim();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(e);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, 10);
  const isOwner = e === OWNER_EMAIL ? 1 : 0;
  const info = db.prepare('INSERT INTO users (name, email, password, is_owner) VALUES (?, ?, ?, ?)')
    .run(name || 'Guest', e, hash, isOwner);
  const user = { id: info.lastInsertRowid, email: e, is_owner: isOwner, name: name || 'Guest' };
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ user: { name: user.name, email: user.email, is_owner: !!user.is_owner } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const e = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  // keep owner flag in sync with .env
  if (e === OWNER_EMAIL && !user.is_owner) {
    db.prepare('UPDATE users SET is_owner = 1 WHERE id = ?').run(user.id);
    user.is_owner = 1;
  }
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ user: { name: user.name, email: user.email, is_owner: !!user.is_owner } });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ---------- products ----------
app.get('/api/products', (_req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id ASC').all();
  res.json(rows);
});

// owner: list ALL (incl inactive)
app.get('/api/admin/products', requireOwner, (_req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id ASC').all());
});

// owner: create
app.post('/api/admin/products', requireOwner, (req, res) => {
  const { name, brand, notes, description, size, price, stock, accent, image } = req.body || {};
  if (!name || !brand || price == null) return res.status(400).json({ error: 'Name, brand and price required.' });
  const info = db.prepare(`INSERT INTO products (name, brand, notes, description, size, price, stock, accent, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, brand, notes || '', description || '', size || '', Math.round(price), stock ?? 50, accent || '#b8975a', image || '');
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

// owner: update (prices and everything)
app.put('/api/admin/products/:id', requireOwner, (req, res) => {
  const id = +req.params.id;
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Not found.' });
  const f = req.body || {};
  db.prepare(`UPDATE products SET name=?, brand=?, notes=?, description=?, size=?, price=?, stock=?, accent=?, image=?, active=? WHERE id=?`)
    .run(
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
      id
    );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

// owner: delete
app.delete('/api/admin/products/:id', requireOwner, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

// owner: upload a PNG/JPG image for a product.
// The browser sends the file as a base64 data URL; we save it to /public/images
// and store the public path on the product so it loads fast (not from the DB).
app.post('/api/admin/products/:id/image', requireOwner, (req, res) => {
  const id = +req.params.id;
  const p = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });

  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'No image data received.' });

  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|avif);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Please upload a PNG, JPG, WEBP or AVIF image.' });

  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 8MB).' });

  const dir = path.join(__dirname, 'public', 'images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `p${id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);

  const publicPath = `/images/${filename}`;
  db.prepare('UPDATE products SET image = ? WHERE id = ?').run(publicPath, id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

// owner: import an image by URL (for dragging/pasting from other websites).
// The SERVER fetches the URL so it isn't blocked by browser CORS rules.
app.post('/api/admin/products/:id/image-url', requireOwner, async (req, res) => {
  const id = +req.params.id;
  const p = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });

  let { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'No image URL received.' });
  url = url.trim();

  // If it's already a data URL, reuse the file-upload path logic.
  const dataMatch = url.match(/^data:image\/(png|jpe?g|webp|avif|gif);base64,(.+)$/);
  try {
    let buf, ext;
    if (dataMatch) {
      ext = dataMatch[1] === 'jpeg' ? 'jpg' : dataMatch[1];
      buf = Buffer.from(dataMatch[2], 'base64');
    } else {
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Please provide a valid http(s) image URL.' });
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 NoirAtelier' } });
      if (!resp.ok) return res.status(400).json({ error: `Could not fetch image (HTTP ${resp.status}).` });
      const type = (resp.headers.get('content-type') || '').toLowerCase();
      const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
      ext = map[type.split(';')[0].trim()];
      if (!ext) return res.status(400).json({ error: 'That link is not a PNG, JPG, WEBP, AVIF or GIF image.' });
      buf = Buffer.from(await resp.arrayBuffer());
    }
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 8MB).' });

    const dir = path.join(__dirname, 'public', 'images');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `p${id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), buf);
    const publicPath = `/images/${filename}`;
    db.prepare('UPDATE products SET image = ? WHERE id = ?').run(publicPath, id);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } catch (err) {
    console.error('image-url error:', err.message);
    res.status(500).json({ error: 'Could not import that image. Try saving it and uploading the file instead.' });
  }
});

// ---------- cart (saved server-side per user) ----------
function getCart(userId) {
  return db.prepare(`
    SELECT ci.product_id AS id, ci.qty, p.name, p.brand, p.price, p.size, p.accent, p.image
    FROM cart_items ci JOIN products p ON p.id = ci.product_id
    WHERE ci.user_id = ? ORDER BY ci.id ASC
  `).all(userId);
}

app.get('/api/cart', requireAuth, (req, res) => res.json(getCart(req.user.id)));

app.post('/api/cart', requireAuth, (req, res) => {
  const { product_id, qty = 1 } = req.body || {};
  const p = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  db.prepare(`INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + excluded.qty`)
    .run(req.user.id, product_id, Math.max(1, qty));
  res.json(getCart(req.user.id));
});

app.put('/api/cart/:id', requireAuth, (req, res) => {
  const qty = Math.max(0, +req.body.qty || 0);
  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, +req.params.id);
  } else {
    db.prepare('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?')
      .run(qty, req.user.id, +req.params.id);
  }
  res.json(getCart(req.user.id));
});

app.delete('/api/cart/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, +req.params.id);
  res.json(getCart(req.user.id));
});

// Stripe endpoints removed. Manual payment flow creates pending orders via /api/order/create

// NOTE: We intentionally do NOT save shipping server-side until the user starts payment.
// The frontend persists shipping locally and sends it when creating a pending order.

// Create an order for manual payment methods (Revolut/PayPal).
// Records shipping details and marks the order as 'pending'. Clears the cart.
app.post('/api/order/create', requireAuth, (req, res) => {
  // If a draft id is provided, convert that draft to pending
  const cart = getCart(req.user.id);
  if (!cart.length) return res.status(400).json({ error: 'Your cart is empty.' });
  const { draft_id } = req.body || {};
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    if (draft_id) {
      const d = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = ?').get(draft_id, req.user.id, 'address');
      if (!d) return res.status(404).json({ error: 'Draft not found.' });
      db.prepare(`UPDATE orders SET total = ?, items_json = ?, status = 'pending' WHERE id = ?`).run(total, JSON.stringify(cart), draft_id);
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
      // Do NOT notify owner when creating a pending order. Owner will be notified only when customer confirms payment.
      return res.json({ ok: true, order_id: draft_id });
    }
  // fallback: create a new pending order (legacy)
  const { name, address, city, postcode, country, phone } = req.body || {};
  if (!name || !address || !city || !postcode || !country) return res.status(400).json({ error: 'Please provide full shipping details.' });
  const info = db.prepare(`INSERT INTO orders (user_id, email, total, items_json, status, shipping_name, shipping_address, shipping_city, shipping_postcode, shipping_country, shipping_phone)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`) 
    .run(req.user.id, req.user.email, total, JSON.stringify(cart), name, address, city, postcode, country, phone || '');
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  // Do NOT notify owner when creating a pending order. Owner will be notified only when customer confirms payment.
  res.json({ ok: true, order_id: info.lastInsertRowid });
});

// Stripe confirm endpoint removed — paid orders are handled manually by the owner marking orders as paid.

// Admin: mark order as paid
app.post('/api/admin/orders/:id/paid', requireOwner, (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', id);
  res.json({ ok: true });
});

// Admin: mark order as pending/not paid
app.post('/api/admin/orders/:id/pending', requireOwner, (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('pending', id);
  res.json({ ok: true });
});

// Admin: delete order
app.delete('/api/admin/orders/:id', requireOwner, (req, res) => {
  const id = +req.params.id;
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Customer: fetch own order
app.get('/api/order/:id', requireAuth, (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json(o);
});

// Customer: notify owner that payment was completed (sets customer_confirmed flag)
app.post('/api/order/:id/notify-paid', requireAuth, (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  db.prepare('UPDATE orders SET customer_confirmed = 1 WHERE id = ?').run(id);
  // notify owner that the customer marked the order as paid
  try {
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    sendOrderEmail(id, 'customer_confirmed', orderRow);
  } catch (e) { /* ignore */ }
  res.json({ ok: true });
});

// owner: view orders
app.get('/api/admin/orders', requireOwner, (_req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all());
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  NOIR ATELIER running → ${BASE_URL}`);
  console.log(`  Stripe payments: removed`);
  console.log(`  Owner email: ${OWNER_EMAIL}\n`);
});
