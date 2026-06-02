import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';

// ----------------------------------------------------------
// 20 real fragrances. Prices are in CENTS (e.g. 14500 = €145.00)
// You can edit all of this later from the website admin panel.
// ----------------------------------------------------------
const products = [
  { name: 'Sauvage EDP',            brand: 'Dior',                notes: 'Bergamot · Ambroxan · Vanilla',          size: '100ml', price: 13500, accent: '#5b6e8c', description: 'A radically fresh, raw composition. Bright bergamot meets a powerful woody-ambery trail.' },
  { name: 'Bleu de Chanel EDP',     brand: 'Chanel',              notes: 'Citrus · Cedar · Sandalwood',            size: '100ml', price: 14800, accent: '#2f4a6b', description: 'An aromatic-woody fragrance of timeless elegance and unexpected freshness.' },
  { name: 'Aventus',                brand: 'Creed',               notes: 'Pineapple · Birch · Musk',               size: '100ml', price: 39500, accent: '#8a8f98', description: 'The iconic fruity-smoky signature. Bold, confident and unmistakable.' },
  { name: 'Oud Wood',               brand: 'Tom Ford',            notes: 'Oud · Rosewood · Cardamom',              size: '50ml',  price: 27500, accent: '#6b4a2f', description: 'Rare oud wood smoothed by warm spice and a creamy, smoky finish.' },
  { name: 'Black Orchid',          brand: 'Tom Ford',            notes: 'Truffle · Black Orchid · Patchouli',     size: '100ml', price: 16500, accent: '#3a2b4a', description: 'A luxurious, sensual fragrance of rich dark accords and an alluring potion of black orchids.' },
  { name: 'La Nuit de L\'Homme',    brand: 'Yves Saint Laurent',  notes: 'Cardamom · Lavender · Cedar',            size: '100ml', price: 11500, accent: '#1f1f24', description: 'Seductive and refined. A magnetic contrast of fresh spice and warm woods.' },
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
  { name: 'Ombré Leather',          brand: 'Tom Ford',            notes: 'Leather · Jasmine · Patchouli',          size: '100ml', price: 17500, accent: '#5a3a2b', description: 'Soft, supple leather with a floral edge. Raw, warm and effortlessly cool.' },
  { name: 'Grand Soir',             brand: 'Maison Francis K.',   notes: 'Amber · Vanilla · Benzoin',              size: '70ml',  price: 26500, accent: '#7a5a2f', description: 'A golden amber glow — warm, smooth and quietly luxurious for the evening.' },
  { name: 'Fucking Fabulous',       brand: 'Tom Ford',            notes: 'Almond · Leather · Tonka',               size: '50ml',  price: 29500, accent: '#3a2f2b', description: 'A daring leather-amber with creamy almond and bitter herbs. Provocative and unique.' },
];

const insert = db.prepare(`
  INSERT INTO products (name, brand, notes, description, size, price, stock, accent, image)
  VALUES (@name, @brand, @notes, @description, @size, @price, 50, @accent, @image)
`);

const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (count === 0) {
  // products 1-10 ship with generated bottle images in /public/images/
  const tx = db.transaction((rows) => rows.forEach((r, idx) => {
    const image = idx < 10 ? `/images/${idx + 1}.png` : '';
    insert.run({ ...r, image });
  }));
  tx(products);
  console.log(`✓ Seeded ${products.length} fragrances.`);
} else {
  console.log(`• Products already exist (${count}). Skipping product seed.`);
}

// ---- Seed the owner account ----
const ownerEmail = (process.env.OWNER_EMAIL || 'numbell98@gmail.com').toLowerCase();
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
if (!existing) {
  const defaultPass = 'changeme123';
  const hash = bcrypt.hashSync(defaultPass, 10);
  db.prepare('INSERT INTO users (name, email, password, is_owner) VALUES (?, ?, ?, 1)')
    .run('Owner', ownerEmail, hash);
  console.log(`✓ Created owner account: ${ownerEmail}`);
  console.log(`  TEMP PASSWORD: ${defaultPass}  (log in and you're the admin — change it anytime)`);
} else {
  db.prepare('UPDATE users SET is_owner = 1 WHERE email = ?').run(ownerEmail);
  console.log(`• Owner account already exists: ${ownerEmail} (ensured admin).`);
}

console.log('Done.');
