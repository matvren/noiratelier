# NOIR ATELIER — your fragrance store

A clean, dark, minimal fragrance shop with real login, saved carts, an owner-only
admin panel, and real Stripe checkout. Built with Node.js + Express + SQLite.

---

## 1. Run it locally (2 minutes)

You need [Node.js](https://nodejs.org) installed (v18+).

```bash
cd noir-atelier
npm install          # install dependencies (only once)
npm run seed         # load the 20 fragrances + create your owner account (only once)
npm start            # start the website
```

Then open **http://localhost:3000** in your browser.

### Your owner login
- **Email:** `numbell98@gmail.com`
- **Temporary password:** `changeme123`

You are the **only** owner. When you log in you'll see an **Admin** link in the top bar
where you can edit every price, edit details, add new fragrances, and delete ones.
Nobody else gets that — regular customers only get a normal account + saved cart.

> Want a different password? Just sign up fresh isn't needed — you can leave it, but
> if you want to change it, tell me and I'll add a "change password" screen, or delete
> `noir.db` and re-seed.

---

## 1b. Add / change product photos (PNG upload)

You can put a real photo on any fragrance straight from the website:

Sign in as the owner and open the **Admin** page. In the **Manage collection**
table, each row has a small image thumbnail (leftmost column). You can set a photo
in **four** ways — all accept **PNG / JPG / WEBP / AVIF / GIF** (max 8 MB):

1. **Click** the thumbnail (or the **Upload** button) and pick a file.
2. **Drag a file** from your computer/desktop straight onto the thumbnail.
3. **Drag an image from another website** onto the thumbnail — the server fetches
   it for you (this avoids the browser's CORS blocking).
4. **Copy & paste:** click the thumbnail to focus it, then press **Ctrl/Cmd + V**
   to paste a copied image (or a copied image link).

The image saves into `public/images/` and shows on the shop instantly.

> To add a brand-new fragrance with a photo: use **"Add a new fragrance"** to
> create it first, then set its image from its new table row.
>
> Note: some sites block hot-linking/copying their images. If a drag from another
> site doesn't work, just **save the image** to your computer and drag/upload the file.

> Fragrances 1–10 already ship with generated bottle images. Tip: for a clean,
> consistent look, use square-ish photos on a dark background.

---

## 2. Turn on real payments (Stripe → Revolut)

Right now payments are **off** until you add Stripe keys. Here's exactly how, step by step.

### Step A — Make a Stripe account
1. Pay via your chosen provider (Revolut/PayPal/bank transfer) and then click the
   "I've paid" button on the pending order page.

### Step B — Get your API keys
1. Make the payment with your preferred method. There is no Stripe integration
   in this deployment.

### Step C — Paste keys into the app
Open the file **`.env`** (it was created for you) and fill in:

```
# No Stripe keys required for manual payments
```

Save, then restart the server (`Ctrl+C` then `npm start`). Checkout now works —
clicking "Checkout securely" sends customers to Stripe's hosted payment page.

### Step D — Send your money to Revolut 💳
Stripe holds the money from sales, then **pays it out to a bank account you choose.**
You point that payout at your Revolut account:

1. In Stripe dashboard → **Settings → Business → Bank accounts & payout details**
   (or **Balance → Payout settings**).
2. Add a bank account. Use your **Revolut account details**:
   - For EUR: use the **IBAN + BIC** shown in your Revolut app
     (Revolut app → your EUR account → *Account details* → IBAN/BIC).
   - For GBP: use the **sort code + account number** from Revolut.
3. Stripe then automatically deposits your sales into Revolut on a rolling schedule
   (default is daily/every few days; you can set manual payouts too).

> ✅ Revolut personal/business accounts with a real IBAN work as a Stripe payout
> destination. Just make sure the **currency matches** (this store charges in EUR,
> so use your Revolut **EUR** IBAN to avoid conversion fees).

### About fees ("cheap loss of money")
- Stripe's standard fee in Europe is roughly **1.5% + €0.25** per successful card
  charge for European cards (a bit more for non-European/Amex cards). No setup fee,
  no monthly fee.
- Stripe → Revolut payouts are **free** when currencies match. Keep the store in EUR
  and pay out to a Revolut EUR IBAN to avoid any FX conversion cost.
- This is about as low-fee as mainstream card processing gets. (Always check
  https://stripe.com/pricing for reference.)

---

## 3. Currency / language note
The store is set to **EUR (€)**. To change the currency, tell me and I'll switch it
(it's set in `server.js` checkout + the `euro()` formatter).

---

## 4. Putting it online (when ready)
This runs anywhere that supports Node.js. Easy options: **Render**, **Railway**,
**Fly.io**, or a small VPS. When you deploy:
- Set the same environment variables (`.env` values) in the host's dashboard.
- Set `BASE_URL` to your real domain (e.g. `https://noiratelier.com`) so Stripe
  redirects back correctly.
- Switch to **live** Stripe keys.

Tell me where you want to host it and I'll give you exact deploy steps.

---

## File map
```
noir-atelier/
├─ server.js        # backend: auth, cart, products, admin, Stripe checkout
├─ db.js            # database schema (SQLite)
├─ seed.js          # loads 20 fragrances + your owner account
├─ .env             # YOUR secrets (Stripe keys, owner email) — edit this
├─ .env.example     # template
├─ noir.db          # the database file (created after seed)
└─ public/
   ├─ index.html    # the site
   ├─ styles.css    # dark minimal theme
   └─ app.js        # frontend logic
```
