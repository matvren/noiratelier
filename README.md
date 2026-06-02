# NOIR ATELIER — your fragrance store

A clean, dark, minimal fragrance shop with real login, saved carts, an owner-only
admin panel, and real Stripe checkout. Built with Node.js + Express + SQLite.

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
