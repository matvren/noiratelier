// ---------------- NOIR ATELIER frontend ----------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  user: null,
  products: [],
  cart: [],      // server cart when logged in
  guestCart: [], // localStorage cart when logged out
  authMode: 'login',
  // ---- shop UI state ----
  query: '',          // search text
  brand: 'all',       // active brand filter
  sort: 'featured',   // sort mode
  wishlist: [],       // saved favourite product ids (localStorage)
};
// admin poll id for updating pending orders badge
let _adminPollId = null;

const euro = (c) => '€' + (c / 100).toFixed(2);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // include status for clearer errors (helps diagnose 404/500)
    const msg = data && data.error ? data.error : `Request failed (${res.status} ${res.statusText})`;
    throw new Error(msg);
  }
  return data;
};

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  // force reflow so the animation plays when adding the class
  void t.offsetHeight;
  t.classList.add('show');
  clearTimeout(t._t);
  // hide after 2200ms, then fully remove from layout after animation
  t._t = setTimeout(() => {
    t.classList.remove('show');
    // wait for CSS transition to finish (~280ms), then hide and clear text
    setTimeout(() => { t.style.display = 'none'; t.textContent = ''; }, 320);
  }, 2200);
}

// ---------- guest cart (localStorage) ----------
const GUEST_KEY = 'noir_guest_cart';
const CART_VER_KEY = 'noir_cart_v2';
function loadGuest() {
  // wipe old guest cart after code update
  if (!localStorage.getItem(CART_VER_KEY)) { localStorage.removeItem(GUEST_KEY); localStorage.setItem(CART_VER_KEY, '1'); }
  try { state.guestCart = JSON.parse(localStorage.getItem(GUEST_KEY)) || []; }
  catch { state.guestCart = []; }
}
function saveGuest() { localStorage.setItem(GUEST_KEY, JSON.stringify(state.guestCart)); }

// ---------- wishlist (localStorage) ----------
const WISH_KEY = 'noir_wishlist';
function loadWishlist() {
  try { state.wishlist = JSON.parse(localStorage.getItem(WISH_KEY)) || []; }
  catch { state.wishlist = []; }
}
function saveWishlist() { localStorage.setItem(WISH_KEY, JSON.stringify(state.wishlist)); }
function toggleWishlist(id) {
  if (state.wishlist.includes(id)) state.wishlist = state.wishlist.filter((x) => x !== id);
  else state.wishlist.push(id);
  saveWishlist();
  updateWishCount();
  toast(state.wishlist.includes(id) ? 'Added to favourites' : 'Removed from favourites');
}
function updateWishCount() {
  const el = $('#wishCount');
  if (el) el.textContent = state.wishlist.length;
}

function activeCart() {
  if (state.user) return state.cart;
  // hydrate guest cart with product data
  return state.guestCart.map((g) => {
    const p = state.products.find((x) => x.id === g.id);
    return p ? { ...p, qty: g.qty } : null;
  }).filter(Boolean);
}

// ---------- init ----------
async function init() {
  $('#year').textContent = new Date().getFullYear();
  loadGuest();
  loadWishlist();
  // measure scrollbar width early so we don't cause a layout shift later
  try {
    const div = document.createElement('div');
    div.style.width = '100px'; div.style.height = '100px'; div.style.overflow = 'scroll'; div.style.position = 'absolute'; div.style.top = '-9999px';
    document.body.appendChild(div);
    const sw = div.offsetWidth - div.clientWidth;
    document.body.removeChild(div);
    document.documentElement.style.setProperty('--scrollbar-w', sw + 'px');
  } catch (e) { /* ignore */ }
  // Be defensive: if API calls fail (server down / network), don't let the whole app crash.
  try {
    const cfg = await api('/api/config');
    state.user = cfg.user;
    state.pending_orders_count = cfg.pending_orders_count || 0;
  } catch (err) {
    console.warn('Could not load config, continuing offline:', err && err.message ? err.message : err);
    state.user = null;
  }

  try {
    state.loadingProducts = true;
    state.products = await api('/api/products');
    state.loadingProducts = false;
  } catch (err) {
    console.warn('Could not load products, showing empty catalogue:', err && err.message ? err.message : err);
    state.products = [];
  }

  // clean stale guest cart items (product no longer exists)
  const validIds = new Set(state.products.map(p => p.id));
  state.guestCart = state.guestCart.filter(g => validIds.has(g.id));
  saveGuest();

  if (state.user) {
    try { await refreshCart(); } catch (err) { console.warn('Could not refresh cart:', err); state.cart = []; }
  }

  syncAuthUI();
  updateCartCount();
  updateWishCount();
  renderAdminBadge();
  updateSearchLabel();
  // Protect routing from throwing — if a render function fails, show a minimal fallback
  try { route(); }
  catch (err) {
    console.error('Routing/render failed:', err);
    // Fallback: show shop placeholder so the user still sees something
    state.products = state.products || [];
    renderShop();
  }
  bindGlobal();
  // run app load entrance animation — wait for fonts when possible to avoid a visible layout shift
  const addAppLoaded = () => {
    if (!document.documentElement.classList.contains('app-loaded')) document.documentElement.classList.add('app-loaded');
  };
  if (document.fonts && document.fonts.ready) {
    // Show once fonts are ready or after a short fallback timeout so we don't hang
    let fired = false;
    document.fonts.ready.then(() => { if (!fired) { fired = true; addAppLoaded(); } }).catch(() => { if (!fired) { fired = true; addAppLoaded(); } });
    setTimeout(() => { if (!fired) { fired = true; addAppLoaded(); } }, 350);
  } else {
    // older browsers: fallback to short delay
    setTimeout(addAppLoaded, 80);
  }
}

function renderAdminBadge() {
  const el = $('#adminLink');
  if (!el) return;
  const count = state.pending_orders_count || 0;
  el.hidden = !(state.user && state.user.is_owner);
  // remove existing badge(s)
  el.querySelectorAll('.admin-badge').forEach(n => n.remove());
  if (count > 0) {
    const span = document.createElement('span');
    span.className = 'admin-badge';
    span.textContent = count > 99 ? '99+' : String(count);
    span.style.cssText = 'background:var(--gold);color:#000;border-radius:12px;padding:2px 8px;margin-left:8px;font-weight:700;font-size:12px;vertical-align:middle';
    el.appendChild(span);
  }
}

function startAdminPoll() {
  stopAdminPoll();
  if (!(state.user && state.user.is_owner)) return;
  // poll /api/config every 12s for pending orders count
  let prev = state.pending_orders_count || 0;
  _adminPollId = setInterval(async () => {
    try {
      const cfg = await api('/api/config');
      const next = cfg.pending_orders_count || 0;
      // if count increased, show a visual alert and toast
      if (next > prev) {
        // small toast
        toast(next - prev === 1 ? 'A customer marked payment — check orders' : `${next - prev} customers marked payment`);
        // pulse badge visually
        const el = document.querySelector('#adminLink .admin-badge');
        if (el) {
          el.classList.add('pulse');
          setTimeout(() => el.classList.remove('pulse'), 2200);
        }
      }
      prev = next;
      state.pending_orders_count = next;
      renderAdminBadge();
    } catch (e) { /* ignore */ }
  }, 12000);
}

function stopAdminPoll() { if (_adminPollId) { clearInterval(_adminPollId); _adminPollId = null; } }

// ---------- shop filtering / sorting ----------
function visibleProducts() {
  let list = state.products.slice();
  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter((p) =>
      (p.name + ' ' + p.brand + ' ' + (p.notes || '') + ' ' + (p.description || ''))
        .toLowerCase().includes(q));
  }
  if (state.brand !== 'all') list = list.filter((p) => p.brand === state.brand);
  switch (state.sort) {
    case 'price-asc': list.sort((a, b) => a.price - b.price); break;
    case 'price-desc': list.sort((a, b) => b.price - a.price); break;
    case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'newest': list.sort((a, b) => b.id - a.id); break;
    default: break; // featured = original order
  }
  return list;
}

async function refreshCart() {
  if (state.user) state.cart = await api('/api/cart');
}

function syncAuthUI() {
  $('#authBtn').textContent = state.user ? 'Sign out' : 'Sign in';
  $('#adminLink').hidden = !(state.user && state.user.is_owner);
  $('#adminLinkMob').hidden = !(state.user && state.user.is_owner);
  $('#authBtnMob').textContent = state.user ? 'Sign out — ' + state.user.name : 'Sign in';
  if (state.user && state.user.is_owner) startAdminPoll(); else stopAdminPoll();
}

function updateCartCount() {
  const n = activeCart().reduce((s, i) => s + i.qty, 0);
  $('#cartCount').textContent = n;
}

// ---------- routing ----------
function route() {
  const v = location.hash.replace('#', '') || 'shop';
  try { if (window.va) va('view', { url: '/' + v }); } catch (e) { /* analytics optional */ }
  if (v === 'admin') renderAdmin();
  else if (v === 'about') renderAbout();
  else if (v === 'wishlist') renderWishlist();
  else if (v === 'checkout') renderCheckout();
  else if (v.startsWith('thanks')) renderThanks();
  else if (v.startsWith('pending')) renderPending();
  else if (v === 'contact') renderContact();
  else renderShop();
  window.scrollTo(0, 0);
}

function renderThanks() {
  const q = new URLSearchParams(location.hash.replace('#', '').split('?')[1] || '');
  const orderId = q.get('order') || '';
  // fetch order and ensure it is actually paid before showing final thanks
  (async () => {
    try {
      const resp = await api('/api/order/' + orderId);
      if (resp.status === 'paid') {
        // Ensure client-side cart is cleared when an order is confirmed paid
        try { state.cart = []; state.guestCart = []; saveGuest(); try { refreshCart(); } catch (e) {} updateCartCount(); try { renderCart(); } catch (e) {} try { closeCart(); } catch (e) {} } catch (e) { /* ignore */ }
        try { localStorage.removeItem('noir_pending'); } catch (e) { }
        $('#view').innerHTML = `
          <section class="section">
            <div style="max-width:640px;margin:40px auto;text-align:center">
              <h2>Thank you — your order is complete</h2>
              ${orderId ? `<p class="co-secure">Order ID: <b>#${orderId}</b></p>` : ''}
              <a href="#shop" class="btn-primary">Back to shop</a>
            </div>
          </section>`;
      } else {
        // not paid — redirect to pending page
        location.hash = '#pending?order=' + orderId;
      }
    } catch (e) {
      // if fetch fails, show a neutral message
      $('#view').innerHTML = `<section class="section"><div style="max-width:640px;margin:40px auto;text-align:center"><h2>Thanks</h2>${orderId ? `<p class="co-secure">Order ID: <b>#${orderId}</b></p>` : ''}<a href="#shop" class="btn-primary">Back to shop</a></div></section>`;
    }
  })();
}

function renderPending() {
  const q = new URLSearchParams(location.hash.replace('#', '').split('?')[1] || '');
  const orderId = q.get('order') || '';
  // if no server-side order id provided, try to show client-side pending info (payment started but order not created)
  const pendingLocal = !orderId ? (() => { try { return JSON.parse(localStorage.getItem('noir_pending') || 'null'); } catch (e) { return null; } })() : null;
  $('#view').innerHTML = `
    <section class="section">
      <div style="max-width:640px;margin:40px auto;text-align:center">
        <h2>Your order is pending</h2>
        ${orderId ? `<p class="co-secure">Order ID: <b>#${orderId}</b></p>` : ''}
        <p class="co-secure">We created a pending order for your payment. Once you complete the payment on the payment provider, click <b>I've paid</b> to notify us and speed up processing. The owner will verify and mark the order as paid.</p>
        <div style="margin-top:18px;text-align:center;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button type="button" class="btn-minimal" id="iPaidBtn">I've paid</button>
          <button type="button" class="btn-minimal secondary" id="iDidntBtn">I didn't pay</button>
        </div>
      </div>
    </section>`;
  $('#iPaidBtn').onclick = async () => {
    openConfirm({
      message: "Are you sure you've completed the payment? This will notify the owner.",
      confirmText: "Yes, I've paid",
      cancelText: "Not yet",
      onConfirm: async () => {
            try {
              // if this is a purely client-side pending (no server order id), create the server pending order now with the saved shipping
              let oid = orderId;
              if (!oid) {
                const ship = pendingLocal || JSON.parse(localStorage.getItem('noir_pending') || 'null');
                if (!ship) { toast('No payment session found. Please confirm shipping and try again.'); return; }
                const data = await api('/api/order/create', { method: 'POST', body: ship });
                oid = data.order_id;
                // clear local pending after creating server order
                try { localStorage.removeItem('noir_pending'); } catch (e) { }
              }
              // Clear client-side cart so UI matches server (server also clears server-side cart when creating order)
              try { state.cart = []; state.guestCart = []; saveGuest(); updateCartCount(); try { renderCart(); } catch (e) {} try { closeCart(); } catch (e) {} } catch (e) { /* ignore */ }
              await api('/api/order/' + oid + '/notify-paid', { method: 'POST' });
              // Ensure client and server cart are in sync after order creation/notification
              try { await refreshCart(); } catch (e) { /* ignore */ }
              try { localStorage.removeItem('noir_pending'); } catch (e) { }
              toast('Notified — owner will verify your payment shortly');
              // fetch latest config to update badge immediately (useful if you're the owner testing)
              try {
                const prev = state.pending_orders_count || 0;
                const cfg = await api('/api/config');
                const next = cfg.pending_orders_count || prev;
                state.pending_orders_count = next;
                renderAdminBadge();
                if (next > prev) {
                  toast(next - prev === 1 ? 'A customer marked payment — check orders' : `${next - prev} customers marked payment`);
                  const el = document.querySelector('#adminLink .admin-badge');
                  if (el) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 2200); }
                }
              } catch (e) { /* ignore */ }
              // navigate to thanks page so the order ID is preserved in the URL on refresh
              location.hash = '#pending?order=' + oid;
        } catch (e) { toast(e.message); }
      }
    });
  };
  // 'I didn't pay' button: simply return user to shop without notifying admin
  const iDidnt = $('#iDidntBtn');
  if (iDidnt) {
    iDidnt.onclick = (e) => {
      e.preventDefault();
      // ensure we DO NOT call notify-paid; just navigate back to shop
      location.hash = '#shop';
    };
  }
}

// ---------- wishlist view ----------
function renderWishlist() {
  const items = state.products.filter((p) => state.wishlist.includes(p.id));
  const grid = items.length
    ? `<div class="grid" id="shopGrid">${items.map(cardHTML).join('')}</div>`
    : `<div class="empty" style="padding:80px 0">No favourites yet.<br/>Tap the ♡ on any fragrance to save it here.</div>`;
  $('#view').innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2>Your Favourites</h2>
        <span class="count">${items.length} saved</span>
      </div>
      ${grid}
    </section>`;
  const g = $('#shopGrid');
  if (g) {
    $$('[data-add]', g).forEach((b) => b.onclick = (e) => { e.stopPropagation(); addToCart(+b.dataset.add); });
    $$('[data-buy]', g).forEach((b) => b.onclick = (e) => { e.stopPropagation(); buyNow(+b.dataset.buy); });
    $$('[data-fav]', g).forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleWishlist(+b.dataset.fav); renderWishlist(); });
    $$('[data-view]', g).forEach((el) => el.onclick = () => openQuickView(+el.dataset.view));
  }
}

// ---------- views ----------
function bottle(accent) {
  return `<div class="bottle" style="background:linear-gradient(160deg,${accent},#0c0c0e 140%);"></div>`;
}
// Show a real uploaded/generated image if present, otherwise the CSS bottle.
function productVisual(p) {
  if (p.image) {
    return `<img class="card-img" src="${p.image}" alt="${p.brand} ${p.name}" loading="lazy"
      onerror="this.style.display='none'"/>`;
  }
  return bottle(p.accent);
}

function cardHTML(p) {
  const faved = state.wishlist.includes(p.id);
  return `
    <article class="card">
      <button class="fav ${faved ? 'on' : ''}" data-fav="${p.id}" title="Save to favourites" aria-label="Favourite">${faved ? '♥' : '♡'}</button>
      <div class="card-visual" data-view="${p.id}">${productVisual(p)}<span class="badge">${p.size || ''}</span><span class="quick">Quick view</span></div>
      <div class="card-body">
        <span class="card-brand">${p.brand}</span>
        <h3 class="card-name">${p.name}</h3>
        <p class="card-notes">${p.notes || ''}</p>
        <div class="card-foot">
          <div class="card-price">${euro(p.price)}</div>
        </div>
        <div class="card-actions">
          <button class="add-btn" data-add="${p.id}">Add to cart</button>
          <button class="buy-btn" data-buy="${p.id}">Buy now</button>
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const list = visibleProducts();
  const grid = $('#shopGrid');
  const count = $('#shopCount');
  if (count) count.textContent = `${list.length} ${list.length === 1 ? 'fragrance' : 'fragrances'}`;
  if (!grid) return;
  // show loading skeletons while products are loading
  if (state.loadingProducts) {
    grid.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="skeleton-card skeleton">
        <div class="skeleton-thumb"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    `).join('');
    grid.classList.remove('show');
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No fragrances match your search.<br/>Try a different name, brand or note.</div>`;
    grid.classList.remove('show');
    return;
  }
  grid.innerHTML = list.map(cardHTML).join('');
  // staggered entrance: add 'show' then animate children with incremental delays
  grid.classList.remove('show');
  requestAnimationFrame(() => {
    grid.classList.add('show');
    const cards = [...grid.querySelectorAll('.card')];
    cards.forEach((c, i) => { c.style.transitionDelay = `${i * 60}ms`; });
    // IntersectionObserver to animate cards when they enter viewport while scrolling
    try {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((ent) => {
          if (ent.isIntersecting) {
            ent.target.classList.add('in-view');
            // once visible, unobserve
            io.unobserve(ent.target);
          }
        });
      }, { root: document.querySelector('#view'), threshold: 0.12 });
      cards.forEach((c) => io.observe(c));
    } catch (e) {
      // fallback: mark all as visible
      cards.forEach((c) => c.classList.add('in-view'));
    }
    // clear transitionDelay after animation to avoid persistent transitionDelay
    setTimeout(() => { const cards = [...grid.querySelectorAll('.card')]; cards.forEach((c) => { c.style.transitionDelay = ''; }); }, 1000 + cards.length * 60);
  });
  $$('[data-add]', grid).forEach((b) => b.onclick = (e) => { e.stopPropagation(); addToCart(+b.dataset.add); });
  $$('[data-buy]', grid).forEach((b) => b.onclick = (e) => { e.stopPropagation(); buyNow(+b.dataset.buy); });
  $$('[data-fav]', grid).forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleWishlist(+b.dataset.fav); b.classList.toggle('on'); b.textContent = b.classList.contains('on') ? '♥' : '♡'; });
  $$('[data-view]', grid).forEach((el) => el.onclick = () => openQuickView(+el.dataset.view));
}

// ---------- top navbar search dropdown ----------
let searchTempQuery = '';   // typed text, not applied until "Search" or click

function updateSearchLabel() {
  const lbl = $('#searchLabel');
  if (!lbl) return;
  if (state.query) lbl.textContent = `“${state.query}”`;
  else lbl.textContent = 'Search the collection';
}

function renderSearchResults() {
  const wrap = $('#searchResultsWrap');
  const box = $('#searchResults');
  const q = searchTempQuery.trim().toLowerCase();
  if (!q) { wrap.hidden = true; box.innerHTML = ''; return; }
  const list = state.products.filter((p) =>
    (p.name + ' ' + p.brand + ' ' + (p.notes || '')).toLowerCase().includes(q)).slice(0, 6);
  wrap.hidden = false;
  box.innerHTML = list.length
    ? list.map((p) => `<button class="sresult" data-sr="${p.id}">
         <span class="sr-thumb" style="background:${p.image ? `url('${p.image}') center/contain no-repeat #0c0c0e` : `linear-gradient(160deg,${p.accent},#0c0c0e)`}"></span>
         <span class="sr-info"><span class="sr-brand">${p.brand}</span><span class="sr-name">${p.name}</span></span>
         <span class="sr-price">${euro(p.price)}</span></button>`).join('')
    : `<div class="sr-none">No matches</div>`;
  $$('[data-sr]', box).forEach((b) => b.onclick = () => {
    openQuickView(+b.dataset.sr);
    closeSearchPanel();
  });
}

function openSearchPanel() {
  searchTempQuery = state.query;
  const inp = $('#searchInput');
  inp.value = searchTempQuery;
  renderSearchResults();
  $('#searchPanel').hidden = false;
  $('#navSearch').classList.add('open');
  setTimeout(() => inp.focus(), 30);
}
function closeSearchPanel() {
  const p = $('#searchPanel');
  if (p) p.hidden = true;
  $('#navSearch')?.classList.remove('open');
}
function applySearch() {
  state.query = searchTempQuery.trim();
  state.brand = 'all';
  closeSearchPanel();
  updateSearchLabel();
  if (location.hash === '#wishlist' || location.hash === '#about' || location.hash === '#admin') location.hash = '#shop';
  else renderShop();
}

const SORT_LABELS = {
  featured: 'Featured',
  'price-asc': 'Price: Low to High',
  'price-desc': 'Price: High to Low',
  name: 'Name (A–Z)',
  newest: 'Newest',
};

function renderShop() {
  const activeLabel = state.brand !== 'all'
    ? state.brand
    : (state.query ? `“${state.query}”` : null);

  $('#view').innerHTML = `
    <section class="hero" id="hero">
      <div class="eyebrow">Designer & Niche · Curated</div>
      <h1>The art of <em>scent</em>,<br/>refined to its essence.</h1>
      <p>A quiet edit of the world's compelling fragrances — authenticated, beautifully kept, and shipped with care.</p>
      <a href="#shop" class="btn-primary" id="exploreBtn">Explore the collection</a>
    </section>
    <section class="section" id="shop">
      <div class="section-head">
        <div>
          <h2>The Collection</h2>
          ${activeLabel ? `<button class="active-filter" id="clearFilter">Filtered: ${activeLabel} ✕</button>` : ''}
        </div>
        <div class="head-right">
          <span class="count" id="shopCount"></span>
          <div class="cdrop" id="sortDrop">
            <button class="cdrop-btn" id="sortBtn">Sort: <b>${SORT_LABELS[state.sort]}</b> <span class="caret">▾</span></button>
            <div class="cdrop-menu" id="sortMenu" hidden>
              ${Object.entries(SORT_LABELS).map(([v, l]) =>
                `<button class="cdrop-item ${state.sort === v ? 'sel' : ''}" data-sort="${v}">${l}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="grid" id="shopGrid"></div>
    </section>`;

  // clear active filter
  const cf = $('#clearFilter');
  if (cf) cf.onclick = () => { state.brand = 'all'; state.query = ''; updateSearchLabel(); renderShop(); };

  // custom sort dropdown
  const sortBtn = $('#sortBtn'), sortMenu = $('#sortMenu');
  sortBtn.onclick = (e) => { e.stopPropagation(); sortMenu.hidden = !sortMenu.hidden; };
  $$('[data-sort]', sortMenu).forEach((b) => b.onclick = () => {
    state.sort = b.dataset.sort;
    sortMenu.hidden = true;
    renderShop();
  });
  document.addEventListener('click', () => { if (sortMenu) sortMenu.hidden = true; }, { once: true });

  renderGrid();
  // ensure hero search is visible and wired
  const hero = $('#hero'); if (hero) { hero.classList.add('show'); }
  // add floating gold bubbles to hero
  const hp = $('#hero .hero-particles');
  if (!hp && hero) {
    const c = document.createElement('div');
    c.className = 'hero-particles';
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      const sz = 10 + Math.random() * 35;
      const wobble1 = (Math.random() - 0.5) * 50;
      const wobble2 = (Math.random() - 0.5) * 50;
      const wobble3 = (Math.random() - 0.5) * 50;
      const wobble4 = (Math.random() - 0.5) * 50;
      const wobble5 = (Math.random() - 0.5) * 50;
      p.style.cssText = `left:${3+Math.random()*94}%;width:${sz}px;height:${sz}px;--pdur:${14+Math.random()*14}s;--pdelay:${Math.random()*18}s;--pdx1:${wobble1}px;--pdx2:${wobble2}px;--pdx3:${wobble3}px;--pdx4:${wobble4}px;--pdx5:${wobble5}px`;
      c.appendChild(p);
    }
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      const sz = 4 + Math.random() * 7;
      p.style.cssText = `left:${3+Math.random()*94}%;width:${sz}px;height:${sz}px;--pdur:${10+Math.random()*10}s;--pdelay:${Math.random()*20}s;--pdx1:${(Math.random()-0.5)*30}px;--pdx2:${(Math.random()-0.5)*30}px;--pdx3:${(Math.random()-0.5)*30}px;--pdx4:${(Math.random()-0.5)*30}px;--pdx5:${(Math.random()-0.5)*30}px`;
      c.appendChild(p);
    }
    hero.appendChild(c);
  }
  // hero mist clouds
  (function() {
    const h = $('#hero');
    if (!h || h.querySelector('.mist-cloud')) return;
    for (let i = 0; i < 6; i++) {
      const m = document.createElement('div');
      m.className = 'mist-cloud';
      const sz = 80 + Math.random() * 200;
      m.style.cssText = `left:${5+Math.random()*90}%;top:${10+Math.random()*70}%;width:${sz}px;height:${sz}px;animation-duration:${14+Math.random()*16}s;animation-delay:${Math.random()*10}s`;
      h.appendChild(m);
    }
  })();
  // hero search wiring
  const hInp = $('#heroSearchInput'); if (hInp) {
    hInp.oninput = (e) => { searchTempQuery = e.target.value; state.query = searchTempQuery.trim(); updateSearchLabel(); renderGrid(); };
    hInp.onkeydown = (e) => { if (e.key === 'Enter') { state.query = searchTempQuery.trim(); updateSearchLabel(); renderShop(); } };
  }
  const hBtn = $('#heroSearchBtn'); if (hBtn) hBtn.onclick = () => { state.query = (searchTempQuery || '').trim(); updateSearchLabel(); renderShop(); };
}

// ---------- quick view modal ----------
function openQuickView(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const faved = state.wishlist.includes(p.id);
  const wrap = $('#quickModal');
  wrap.innerHTML = `
    <div class="modal quick-modal">
      <button class="modal-close" id="qvClose">✕</button>
      <div class="qv-grid">
        <div class="qv-visual">${productVisual(p)}</div>
        <div class="qv-info">
          <span class="card-brand">${p.brand}</span>
          <h2>${p.name}</h2>
          <div class="qv-notes">${p.notes || ''}</div>
          <p class="qv-desc">${p.description || 'A distinguished fragrance from our curated collection.'}</p>
          <div class="qv-meta"><span>${p.size || ''}</span>${p.stock > 0 ? '<span class="in-stock">In stock</span>' : '<span class="oos">Sold out</span>'}</div>
          <div class="qv-price">${euro(p.price)}</div>
          <div class="qv-actions">
            <button class="btn-primary" id="qvAdd">Add to cart</button>
            <button class="btn-primary" id="qvBuy">Buy now</button>
          </div>
          <button class="qv-fav ${faved ? 'on' : ''}" id="qvFav">${faved ? '♥ Saved' : '♡ Save to favourites'}</button>
        </div>
      </div>
    </div>`;
  wrap.hidden = false;
  $('#qvClose').onclick = closeQuickView;
  wrap.onclick = (e) => { if (e.target.id === 'quickModal') closeQuickView(); };
  $('#qvAdd').onclick = () => { addToCart(id); closeQuickView(); };
  $('#qvBuy').onclick = () => { closeQuickView(); buyNow(id); };
  $('#qvFav').onclick = () => {
    toggleWishlist(id);
    const on = state.wishlist.includes(id);
    $('#qvFav').classList.toggle('on', on);
    $('#qvFav').textContent = on ? '♥ Saved' : '♡ Save to favourites';
    renderGrid();
  };
}
function closeQuickView() { const w = $('#quickModal'); if (w) { w.hidden = true; w.innerHTML = ''; } }

// Buy now = add to cart then go straight to checkout
async function buyNow(id) {
  if (state.user) {
    try {
      state.cart = await api('/api/cart', { method: 'POST', body: { product_id: id, qty: 1 } });
      updateCartCount();
    } catch (e) { toast(e.message); return; }
  } else {
    const ex = state.guestCart.find((g) => g.id === id);
    if (ex) ex.qty++; else state.guestCart.push({ id, qty: 1 });
    saveGuest();
    updateCartCount();
  }
  location.hash = '#checkout';
}

function renderAbout() {
  $('#view').innerHTML = `
    <section class="section">
      <div class="about">
        <div class="eyebrow" style="color:var(--gold);letter-spacing:5px;font-size:12px;text-transform:uppercase;margin-bottom:18px">The House</div>
        <h2>Scent, treated like art.</h2>
        <p>NOIR ATELIER is a small, deliberate house. We don't carry everything — we carry the right things. Each bottle in our collection is chosen for its craftsmanship, its character, and its ability to leave an impression that lingers long after you've left the room.</p>
        <p>Every order is authenticated, carefully packed, and dispatched with discretion. No noise. Just scent, done properly.</p>
        <div class="values">
          <div class="value"><h4>Authenticated</h4><p>Every fragrance verified for authenticity before it ships.</p></div>
          <div class="value"><h4>Secure</h4><p>Pay via Revolut — fast, secure, and completely straightforward.</p></div>
          <div class="value"><h4>Curated</h4><p>A tight edit of designer and niche houses worth your attention.</p></div>
        </div>
      </div>
    </section>`;
}


// ---------- contact ----------
function renderContact() {
  const waMsg = encodeURIComponent("Hi! I saw NOIR ATELIER and I'd like to ask about…");
  $('#view').innerHTML = `
    <section class="section">
      <div class="about">
        <div class="eyebrow" style="color:var(--gold);letter-spacing:5px;font-size:12px;text-transform:uppercase;margin-bottom:18px">Get in touch</div>
        <h2>We're here to help.</h2>
        <p>Questions about a fragrance, your order, or just want a recommendation? Reach out on WhatsApp or give us a call — we're happy to chat.</p>
        <div class="contact-grid">
          <a class="contact-card" href="https://wa.me/qr/B46E3PFMW6NMJ1" target="_blank" rel="noopener">
            <span class="cc-icon">💬</span>
            <h4>WhatsApp</h4>
            <p>Chat with us directly</p>
            <span class="cc-cta">Open WhatsApp →</span>
          </a>
          <a class="contact-card" href="tel:+35795653345">
            <span class="cc-icon">📞</span>
            <h4>Call Us</h4>
            <p>+357 95 653345</p>
            <span class="cc-cta">Tap to call →</span>
          </a>
        </div>
        <div class="pay-step" style="margin-top:36px;max-width:540px;margin-left:auto;margin-right:auto;text-align:left">
          <div class="pay-step-num" style="background:var(--gold);color:#000">💳</div>
          <div class="pay-step-body">
            <h3>Pay with Revolut</h3>
            <p>Ready to order? Pay securely via Revolut using the link below.</p>
            <a class="rev-btn" href="https://revolut.me/tibordoki" target="_blank" rel="noopener">
              <span class="rev-ic">R</span> Pay with Revolut
            </a>
            <div class="rev-handle">revolut.me/tibordoki</div>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------- cart actions ----------
async function addToCart(id) {
  if (state.user) {
    state.cart = await api('/api/cart', { method: 'POST', body: { product_id: id, qty: 1 } });
  } else {
    const ex = state.guestCart.find((g) => g.id === id);
    if (ex) ex.qty++; else state.guestCart.push({ id, qty: 1 });
    saveGuest();
  }
  updateCartCount();
  toast('Added to cart');
  renderCart();
  openCart();
}

async function setQty(id, qty) {
  if (state.user) {
    state.cart = await api('/api/cart/' + id, { method: 'PUT', body: { qty } });
  } else {
    if (qty <= 0) state.guestCart = state.guestCart.filter((g) => g.id !== id);
    else { const g = state.guestCart.find((x) => x.id === id); if (g) g.qty = qty; }
    saveGuest();
  }
  updateCartCount();
  renderCart();
}

async function removeItem(id) { try { await setQty(id, 0); } catch (e) { toast('Could not remove: ' + e.message); } }

function renderCart() {
  const cart = activeCart();
  const body = $('#cartBody');
  const foot = $('#cartFoot');
  if (!cart.length) {
    body.innerHTML = `<div class="empty">Your cart is empty.<br/>Discover something worth wearing.</div>`;
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = cart.map((i) => `
    <div class="cart-line">
      <div class="cart-thumb" style="background:${i.image ? `url('${i.image}') center/cover` : `linear-gradient(160deg,${i.accent},#0c0c0e)`}"></div>
      <div class="info">
        <div class="b">${i.brand}</div>
        <div class="n">${i.name}</div>
        <div class="qty">
          <button data-dec="${i.id}">−</button>
          <span>${i.qty}</span>
          <button data-inc="${i.id}">+</button>
        </div>
      </div>
      <div>
        <div class="price">${euro(i.price * i.qty)}</div>
        <button class="rm" data-rm="${i.id}">Remove</button>
      </div>
    </div>`).join('');

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  foot.innerHTML = `
    <div class="cart-total"><span>Subtotal</span><b>${euro(total)}</b></div>
    <button class="btn-primary" id="checkoutBtn">Checkout</button>
    ${state.user ? '<button class="btn-sm" id="clearCartBtn" style="background:none;border:1px solid var(--line);color:var(--muted);padding:8px 16px;border-radius:30px;font-size:12px;margin-top:8px;width:100%">Clear cart</button>' : ''}`;

  $$('[data-inc]').forEach((b) => b.onclick = () => setQty(+b.dataset.inc, cart.find(c => c.id == b.dataset.inc).qty + 1));
  $$('[data-dec]').forEach((b) => b.onclick = () => setQty(+b.dataset.dec, cart.find(c => c.id == b.dataset.dec).qty - 1));
  $$('[data-rm]').forEach((b) => b.onclick = () => removeItem(+b.dataset.rm));
  $('#checkoutBtn').onclick = () => { closeCart(); location.hash = '#checkout'; };
  const clearBtn = $('#clearCartBtn');
  if (clearBtn) clearBtn.onclick = async () => {
    try {
      state.cart = await api('/api/cart', { method: 'DELETE' });
      renderCart(); updateCartCount(); toast('Cart cleared');
    } catch (e) { toast(e.message); }
  };
}


// ---------- Revolut + WhatsApp checkout page ----------
const REVOLUT_LINK = 'https://revolut.me/tibordoki';
const PAYPAL_LINK = 'https://www.paypal.com/paypalme/timlasty';
const PHONE_NUMBER = '+357 95653345';
const WHATSAPP_LINK = 'https://wa.me/qr/B46E3PFMW6NMJ1';

function renderCheckout() {
  const cart = activeCart();
  if (!cart.length) {
    $('#view').innerHTML = `<section class="section"><div class="empty" style="padding:80px 0">Your cart is empty.<br/><a href="#shop" style="color:var(--gold)">Browse the collection →</a></div></section>`;
    return;
  }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  // total is stored in cents. Keep a display string with two decimals for some places,
  // but for the Revolut amount the user requested an integer-without-dot (cents as integer).
  const totalStr = (total / 100).toFixed(2);
  const totalEurosInt = Math.round(total / 100); // e.g. 6000 cents -> 60
  // Use the raw cents value as the Revolut 'amount' param (no decimal point)
  const revolutHref = `${REVOLUT_LINK}?currency=EUR&amount=${total}`;
  const lines = cart.map((i) => `
    <div class="co-line">
      <div class="co-thumb" style="background:${i.image ? `url('${i.image}') center/contain no-repeat #111` : `linear-gradient(160deg,${i.accent},#0c0c0e)`}"><span class="co-qty">${i.qty}</span></div>
      <div class="co-info"><div class="co-name">${i.brand} — ${i.name}</div><div class="co-sub">${i.size || ''}</div></div>
      <div class="co-price">${euro(i.price * i.qty)}</div>
      <button class="co-remove" data-rm-order="${i.id}" title="Remove item" aria-label="Remove item">🗑</button>
    </div>`).join('');

  // order summary text for the whatsapp message
  const orderText = cart.map((i) => `• ${i.qty}x ${i.brand} ${i.name} — ${euro(i.price * i.qty)}`).join('\n');
  const waMsg = encodeURIComponent(
    `Hi NOIR ATELIER 👋\nI'd like to order:\n${orderText}\n\nTotal: €${totalStr}\nI'm ready to pay via Revolut.`
  );
  const waHref = `${WHATSAPP_LINK}?text=${waMsg}`;

  $('#view').innerHTML = `
  <section class="checkout">
    <div class="co-main">
      <h2 class="co-title">Complete your order</h2>
      <p class="co-secure">Enter your shipping address below — we'll use this to ship your order once payment is received.</p>

      <div class="card-panel" id="shipPanel">
        <h3>Shipping details</h3>
        <div style="margin-top:10px">
          <div style="margin-bottom:8px"><input id="ship_name" class="ship-input" placeholder="Full name" /></div>
          <div style="margin-bottom:8px"><input id="ship_address" class="ship-input" placeholder="Street address" /></div>
          <div class="ship-row">
            <input id="ship_city" class="ship-input" placeholder="City" />
            <input id="ship_postcode" class="ship-input" placeholder="Postcode" />
          </div>
          <div style="margin-top:8px" class="ship-row">
            <input id="ship_country" class="ship-input" placeholder="Country" />
            <input id="ship_phone" class="ship-input" placeholder="Phone (optional)" />
          </div>
          <div class="ship-actions">
            <button class="btn-primary" id="confirmShipping">Confirm shipping</button>
          </div>
        </div>
      </div>
      <div id="savedAddresses" class="addr-list" hidden></div>
      
      <!-- STEP 1: REVOLUT -->
      <div class="pay-step">
        <div class="pay-step-num">1</div>
        <div class="pay-step-body">
          <h3>Pay by Revolut</h3>
          <p>Fast & secure — tap the Revolut button below to complete your payment.</p>
          <a class="rev-btn" href="${revolutHref}" target="_blank" rel="noopener" id="revLink">
            <span class="rev-ic">R</span> Pay with Revolut
          </a>
          <div class="rev-handle">${REVOLUT_LINK.replace('https://', '')}</div>
        </div>
      </div>

      <!-- STEP 2: WHATSAPP -->
      <div class="pay-step">
        <div class="pay-step-num">2</div>
        <div class="pay-step-body">
          <h3>Confirm on WhatsApp</h3>
          <p>Send us a quick message after payment so we can confirm and arrange delivery. Your order details are pre-filled for you.</p>
          <a class="wa-btn" href="${waHref}" target="_blank" rel="noopener" id="waLink">
            <span class="wa-ic">✆</span> Message us on WhatsApp
          </a>
          <div class="rev-handle">${PHONE_NUMBER}</div>
        </div>
      </div>

      <!-- STEP 3: PAYPAL -->
      <div class="pay-step">
        <div class="pay-step-num">3</div>
        <div class="pay-step-body">
          <h3>Pay with PayPal</h3>
          <p>If you prefer PayPal, use the button below to open the PayPal.me page.</p>
          <a class="rev-btn" href="${PAYPAL_LINK}" target="_blank" rel="noopener" id="ppLink">
            <span class="rev-ic">P</span> Pay with PayPal
          </a>
          <div class="rev-handle">paypal.me/timlasty</div>
        </div>
      </div>

      <a class="co-back" href="#shop">← Return to shop</a>
    </div>

      <aside class="co-summary">
      <h3 class="co-sum-title">Your order</h3>
      <div class="co-lines">${lines}</div>
      <div class="co-row"><span>Subtotal · ${cart.reduce((s, i) => s + i.qty, 0)} items</span><span>${euro(total)}</span></div>
      <div class="co-row"><span>Shipping</span><span class="co-muted">Free</span></div>
      <div class="co-total"><span>Total</span><span><small>EUR</small> €${totalStr}</span></div>
    </aside>
  </section>`;

  // attach remove buttons for items in the order summary — use custom themed confirm modal
  $$('[data-rm-order]').forEach((b) => b.onclick = () => {
    const id = +b.dataset.rmOrder;
    openConfirm({
      message: 'Remove this item from your order?',
      confirmText: 'Remove',
      cancelText: 'Keep',
      onConfirm: async () => { try { await setQty(id, 0); renderCheckout(); } catch (e) { toast(e.message); } },
    });
  });

  // helper to gather shipping values
  function gatherShipping() {
    return {
      name: (document.getElementById('ship_name')?.value || '').trim(),
      phone: (document.getElementById('ship_phone')?.value || '').trim(),
      address: (document.getElementById('ship_address')?.value || '').trim(),
      city: (document.getElementById('ship_city')?.value || '').trim(),
      postcode: (document.getElementById('ship_postcode')?.value || '').trim(),
      country: (document.getElementById('ship_country')?.value || '').trim(),
    };
  }

  // Saved-addresses helpers: support up to 5 addresses in localStorage under 'noir_shipping'.
  function getSavedAddresses() {
    try {
      const v = JSON.parse(localStorage.getItem('noir_shipping') || 'null');
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    } catch (e) { return []; }
  }
  function persistSavedAddresses(list) { localStorage.setItem('noir_shipping', JSON.stringify(list)); }
  function addSavedAddress(addr) {
    const list = getSavedAddresses();
    const a = { name: addr.name || '', address: addr.address || '', city: addr.city || '', postcode: addr.postcode || '', country: addr.country || '', phone: addr.phone || '' };
    // avoid exact duplicates; if it exists, move it to front
    const existsIdx = list.findIndex(x => JSON.stringify(x) === JSON.stringify(a));
    if (existsIdx !== -1) {
      // move to front
      list.splice(existsIdx, 1);
      list.unshift(a);
      persistSavedAddresses(list);
      return true;
    }
    if (list.length >= 5) return false;
    list.unshift(a);
    persistSavedAddresses(list);
    return true;
  }
  function removeSavedAddressAt(idx) {
    const list = getSavedAddresses();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    persistSavedAddresses(list);
  }

  // _localShip holds the currently-chosen shipping details in-memory
  let _localShip = null;
  // If we have saved addresses, pre-fill the form with the first (but do not auto-show payments)
  (function initSaved() {
    const list = getSavedAddresses();
    if (list && list.length) {
      const first = list[0];
      document.getElementById('ship_name').value = first.name || '';
      document.getElementById('ship_address').value = first.address || '';
      document.getElementById('ship_city').value = first.city || '';
      document.getElementById('ship_postcode').value = first.postcode || '';
      document.getElementById('ship_country').value = first.country || '';
      document.getElementById('ship_phone').value = first.phone || '';
      renderSavedAddresses();
    }
  })();
  function saveShippingLocal() {
    const s = gatherShipping();
    if (!s.name || !s.address || !s.city || !s.postcode || !s.country) return toast('Please complete shipping details');
    _localShip = s;
    const ok = addSavedAddress(s);
    if (!ok) { toast('You cannot save more than 5 addresses'); }
    else { toast('Shipping saved'); }
    // reveal payment steps
    document.querySelectorAll('.pay-step').forEach((el) => { el.style.display = ''; el.classList.remove('pay-step-hidden'); });
    // show saved-address UI (but hide it immediately because user confirmed)
    renderSavedAddresses();
    const shipPanel = document.getElementById('shipPanel'); if (shipPanel) shipPanel.hidden = true;
    const savedWrap = document.getElementById('savedAddresses'); if (savedWrap) savedWrap.hidden = true;
  }

  // saved addresses UI: allow using the saved shipping (localStorage) or clearing it
  function renderSavedAddresses() {
    const wrap = $('#savedAddresses');
    const list = getSavedAddresses();
    if (!wrap) return;
    if (!list.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    wrap.hidden = false;
    wrap.innerHTML = list.map((saved, i) => `
      <div class="addr-item addr-anim" data-idx="${i}">
        <div class="addr-text"><strong>${escapeHtml(saved.name)}</strong> — ${escapeHtml(saved.address)}, ${escapeHtml(saved.city)} ${escapeHtml(saved.postcode)} · ${escapeHtml(saved.country)}</div>
        <div class="addr-actions"><button class="btn-sm use" data-use="${i}">Use this one</button><button class="btn-sm remove" data-del="${i}">Remove</button></div>
      </div>`).join('');
    // attach handlers
    wrap.querySelectorAll('[data-use]').forEach((b) => b.onclick = (e) => {
      const idx = +b.dataset.use; const saved = getSavedAddresses()[idx];
      if (!saved) return;
      document.getElementById('ship_name').value = saved.name || '';
      document.getElementById('ship_address').value = saved.address || '';
      document.getElementById('ship_city').value = saved.city || '';
      document.getElementById('ship_postcode').value = saved.postcode || '';
      document.getElementById('ship_country').value = saved.country || '';
      document.getElementById('ship_phone').value = saved.phone || '';
      // reveal payment steps and hide the shipping panel (user chose this saved address)
      document.querySelectorAll('.pay-step').forEach((el) => { el.classList.remove('pay-step-hidden'); el.style.display = ''; });
      const shipPanel = document.getElementById('shipPanel'); if (shipPanel) shipPanel.hidden = true;
      // move used address to front
      addSavedAddress(saved);
      // hide saved-address UI now
      wrap.hidden = true;
      _localShip = saved;
    });
    wrap.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => {
      const idx = +b.dataset.del; removeSavedAddressAt(idx); _localShip = null; renderSavedAddresses(); const shipPanel = document.getElementById('shipPanel'); if (shipPanel) shipPanel.hidden = false; });
  }

  // small helper to avoid HTML injection when writing saved address
  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

  async function startPaymentAndOpen(href) {
    if (!state.user) { openAuth('login'); return; }
    // require shipping saved locally first
    if (!_localShip) return toast('Please confirm shipping details first');
    try {
      // store pending shipping locally (do NOT create server order yet)
      try { localStorage.setItem('noir_pending', JSON.stringify(_localShip)); } catch (e) { /* ignore */ }
      // open payment provider in new tab and show a client-side pending page (no server order created yet)
      window.open(href, '_blank');
      location.hash = '#pending';
    } catch (e) { toast(e.message); }
  }

  // save-draft button
  const confirmShipBtn = $('#confirmShipping'); if (confirmShipBtn) confirmShipBtn.onclick = (e) => { e.preventDefault(); saveShippingLocal(); };

  // render saved addresses UI initially
  renderSavedAddresses();

  // Sanity: if both the shipping panel and saved-address UI are hidden (unexpected), show the shipping panel
  (function ensureShippingVisible() {
    const shipPanel = document.getElementById('shipPanel');
    const saved = document.getElementById('savedAddresses');
    const anyPayVisible = document.querySelectorAll('.pay-step:not(.pay-step-hidden)').length > 0;
    if (shipPanel && shipPanel.hidden && (!saved || saved.hidden) && !anyPayVisible) {
      shipPanel.hidden = false;
    }
  })();

  // wire payment buttons to save shipping first
  // hide all pay-steps until shipping confirmed — use a class so CSS layout remains stable
  document.querySelectorAll('.pay-step').forEach((el) => { el.classList.add('pay-step-hidden'); el.style.display = ''; });
  const revBtn = $('#revLink'); if (revBtn) revBtn.onclick = (e) => {
    e.preventDefault();
    if (!state.user) { state._pendingPaymentHref = revBtn.href; openAuth('login'); return; }
    startPaymentAndOpen(revBtn.href);
  };
  const ppBtn = $('#ppLink'); if (ppBtn) ppBtn.onclick = (e) => {
    e.preventDefault();
    if (!state.user) { state._pendingPaymentHref = ppBtn.href; openAuth('login'); return; }
    startPaymentAndOpen(ppBtn.href);
  };
  const waBtn = $('#waLink'); if (waBtn) waBtn.onclick = (e) => { /* allow whatsapp to open without saving payment */ };
}

// Confirmation modal helpers
function openConfirm({ message, confirmText = 'Yes', cancelText = 'No', onConfirm }) {
  const wrap = $('#confirmModal');
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" id="confirmClose">✕</button>
      <div class="confirm-body">
        <div class="confirm-msg">${message}</div>
        <div class="confirm-actions">
          <button class="btn" id="confirmCancel">${cancelText}</button>
          <button class="btn confirm" id="confirmOk">${confirmText}</button>
        </div>
      </div>
    </div>`;
  wrap.hidden = false;
  // handlers
  $('#confirmClose').onclick = closeConfirm;
  $('#confirmCancel').onclick = closeConfirm;
  $('#confirmOk').onclick = async () => { await closeConfirm(); if (onConfirm) await onConfirm(); };
  // focus the cancel button for safety
  setTimeout(() => { $('#confirmCancel')?.focus(); }, 20);
}
async function closeConfirm() {
  const w = $('#confirmModal');
  if (!w) return;
  const modal = w.querySelector('.modal');
  if (modal) {
    modal.classList.add('leave');
    // wait for animation to finish (~120ms)
    await new Promise((r) => setTimeout(r, 140));
  }
  w.hidden = true; w.innerHTML = '';
}

// ---------- drawer ----------
function openCart() { $('#cartDrawer').classList.add('open'); $('#overlay').classList.add('show'); renderCart(); }
function closeCart() { $('#cartDrawer').classList.remove('open'); $('#overlay').classList.remove('show'); }

// ---------- auth modal ----------
function openAuth(mode = 'login') {
  state.authMode = mode;
  $('#authModal').hidden = false;
  applyAuthMode();
}
function closeAuth() { $('#authModal').hidden = true; $('#authError').textContent = ''; $('#authForm').reset(); }
function applyAuthMode() {
  const signup = state.authMode === 'signup';
  $('#authTitle').textContent = signup ? 'Create account' : 'Sign in';
  $('#authSub').textContent = signup ? 'Join the atelier.' : 'Welcome back to the atelier.';
  $('#authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('#nameField').hidden = !signup;
  $('#switchText').textContent = signup ? 'Already a member?' : 'New here?';
  $('#switchLink').textContent = signup ? 'Sign in' : 'Create an account';
  $('#authError').textContent = '';
}

async function submitAuth(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { name: f.get('name'), email: f.get('email'), password: f.get('password') };
  const endpoint = state.authMode === 'signup' ? '/api/signup' : '/api/login';
  try {
    const { user } = await api(endpoint, { method: 'POST', body });
    state.user = user;
    // if owner, fetch current pending count immediately so badge is accurate
    if (user.is_owner) {
      try { const cfg = await api('/api/config'); state.pending_orders_count = cfg.pending_orders_count || 0; } catch (e) { state.pending_orders_count = 0; }
    }
    // merge guest cart into server cart
    if (state.guestCart.length) {
      for (const g of state.guestCart) {
        await api('/api/cart', { method: 'POST', body: { product_id: g.id, qty: g.qty } });
      }
      state.guestCart = []; saveGuest();
    }
    await refreshCart();
    syncAuthUI(); updateCartCount(); renderCart();
    closeAuth();
    toast(`Welcome${user.name ? ', ' + user.name : ''}`);
    if (user.is_owner) location.hash = '#shop';
    // if there was a pending payment to resume, do it now
    if (state._pendingPaymentHref) {
      const h = state._pendingPaymentHref; state._pendingPaymentHref = null;
      // small delay to ensure cart/session is ready
      setTimeout(() => startPaymentAndOpen(h), 80);
    }
  } catch (err) {
    $('#authError').textContent = err.message;
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  state.user = null; state.cart = [];
  syncAuthUI(); updateCartCount(); renderCart();
  if (location.hash === '#admin') location.hash = '#shop';
  toast('Signed out');
}

// ---------- admin ----------
async function renderAdmin() {
  if (!(state.user && state.user.is_owner)) {
    location.hash = '#shop';
    return;
  }
  const products = await api('/api/admin/products');
  const orders = await api('/api/admin/orders').catch(() => []);
  const revenue = orders.reduce((s, o) => s + o.total, 0);

  $('#view').innerHTML = `
    <section class="section">
      <div class="section-head"><h2>Atelier Admin</h2><span class="count">${products.length} products · ${orders.length} orders · ${euro(revenue)} revenue</span></div>
      <div class="notice">You are signed in as the owner. Edit any price or detail below and hit <b>Save</b>. Changes go live instantly.</div>
      <div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div style="color:var(--gold);font-weight:600;font-size:14px;margin-bottom:4px">💾 Save to GitHub</div>
          <div style="color:var(--muted);font-size:12px;line-height:1.5">Saves the current collection (products, images, descriptions) to GitHub so it survives Vercel cold starts. Click this once you're done editing.</div>
        </div>
        <button id="saveGithub" style="background:var(--gold);color:#000;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;white-space:nowrap">Save to GitHub</button>
      </div>

      <div class="card-panel">
        <h3>Add a new fragrance</h3>
        <div class="form-row-2">
          <div class="field"><span>Name</span><input id="n_name" placeholder="Sauvage EDP"/></div>
          <div class="field"><span>Brand</span><input id="n_brand" placeholder="Dior"/></div>
        </div>
        <div class="form-row-2">
          <div class="field"><span>Notes</span><input id="n_notes" placeholder="Bergamot · Ambroxan"/></div>
          <div class="field"><span>Size</span><input id="n_size" placeholder="100ml"/></div>
        </div>
        <div class="form-row-2">
          <div class="field"><span>Price (€)</span><input id="n_price" type="number" step="0.01" placeholder="135.00"/></div>
          <div class="field"><span>Description <span style="font-weight:400;text-transform:none;color:var(--muted-2)">auto-generated from notes</span><button type="button" id="nRegen" style="background:none;border:none;color:var(--gold);cursor:pointer;font-size:11px;margin-left:6px;text-decoration:underline">↻ regenerate</button></span><input id="n_desc" placeholder="The description is auto-generated from brand + name + notes"/></div>
        </div>
        <div class="field"><span>Image <span style="font-weight:400;text-transform:none;color:var(--muted-2)">(optional)</span></span>
          <div class="add-drop" id="nDrop">
            <div class="add-drop-inner" id="nImgPreview">
              <span class="add-drop-icon" id="nDropIcon">+</span>
              <span class="add-drop-text">Click, drag & drop, or paste an image here</span>
            </div>
            <input type="file" id="nImgFile" accept="image/png,image/jpeg,image/webp,image/avif" hidden/>
          </div>
          <button type="button" id="nImgClear" class="btn-sm" style="font-size:12px;display:none;color:var(--muted-2);margin-top:6px">✕ Clear image</button>
        </div>
        <button class="btn-primary" id="addProduct" style="width:auto">Add fragrance</button>
      </div>

      <div class="card-panel">
        <h3>Manage collection</h3>
        <div style="overflow-x:auto">
        <table class="atable">
          <thead><tr><th>Image</th><th>Brand</th><th>Name</th><th>Notes</th><th>Size</th><th>Price (€)</th><th>Stock</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
        </div>
      </div>
      <div class="card-panel">
        <h3>Orders</h3>
        <div style="overflow-x:auto">
          <table class="atable">
            <thead><tr><th>ID</th><th>Date</th><th>Email</th><th>Total</th><th>Status</th><th>Ship To</th><th>Items</th><th></th></tr></thead>
            <tbody>
            ${orders.map((o) => `
              <tr>
                <td>${o.id}</td>
                <td>${o.created_at}</td>
                <td>${o.email}</td>
                <td>${euro(o.total)}</td>
                <td>${o.status}</td>
                <td>${o.shipping_name || ''}<br/>${o.shipping_address || ''}<br/>${o.shipping_city || ''} ${o.shipping_postcode || ''}<br/>${o.shipping_country || ''}<br/>${o.shipping_phone || ''}</td>
                <td>${(JSON.parse(o.items_json || '[]') || []).map(i => `${i.qty}× ${i.brand} ${i.name}`).join('<br/>')}</td>
                <td style="white-space:nowrap">
                  ${o.status !== 'paid' ? `<button class="btn-admin btn-admin-paid" data-mark-paid="${o.id}">Mark paid</button>` : `<button class="btn-admin btn-admin-pending" data-mark-pending="${o.id}">Mark pending</button>`}
                  <button class="btn-admin btn-admin-del" data-del-order="${o.id}">Delete</button>
                </td>
              </tr>
            `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>`;

  function renderAdminTable(rows) {
    const tbody = document.querySelector('.atable tbody');
    if (!tbody) return;
    tbody.innerHTML = rows.map((p) => `
      <tr data-id="${p.id}">
        <td>
          <div class="img-cell">
            <div class="img-thumb dropzone" tabindex="0" title="Click to upload, or drag/paste an image here" style="${p.image ? '' : `background:linear-gradient(160deg,${p.accent},#0c0c0e)`}">${p.image ? `<img class="thumb-img" src="${p.image}${p.image.startsWith('data:') ? '' : '?t=' + Date.now()}" alt=""/>` : ''}<span class="drop-hint">drop / paste</span></div>
            <button class="upload" type="button">Upload</button>
            <input type="file" class="file-in" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" hidden/>
          </div>
        </td>
        <td><input value="${p.brand}" data-f="brand"/></td>
        <td><input value="${p.name}" data-f="name"/></td>
        <td><input value="${p.notes || ''}" data-f="notes"/></td>
        <td><input value="${p.size || ''}" data-f="size" style="width:70px"/></td>
        <td><input class="price-in" type="number" step="0.01" value="${(p.price/100).toFixed(2)}" data-f="price"/></td>
        <td><input value="${p.stock}" data-f="stock" style="width:60px"/></td>
        <td style="white-space:nowrap"><button class="save">Save</button> <button class="del">Del</button></td>
      </tr>`).join('');
    $$('.atable tbody tr[data-id]').forEach(bindRow);
  }
  renderAdminTable(products);

  let _newImgDataUrl = null;
  const nFileIn = $('#nImgFile');
  const nClear = $('#nImgClear');
  const nDrop = $('#nDrop');
  const nDropInner = $('#nImgPreview');
  const nDropIcon = $('#nDropIcon');
  function setNewImg(dataUrl) {
    _newImgDataUrl = dataUrl;
    nDropInner.innerHTML = `<img src="${dataUrl}" class="add-drop-img"/>`;
    nDrop.classList.add('has-img');
    nClear.style.display = '';
  }
  function clearNewImg() {
    _newImgDataUrl = null; nFileIn.value = '';
    nDrop.classList.remove('has-img');
    nDropInner.innerHTML = '<span class="add-drop-icon" id="nDropIcon">+</span><span class="add-drop-text">Click, drag & drop, or paste an image here</span>';
    nClear.style.display = 'none';
  }
  const nDesc = $('#n_desc');
  const nNotes = $('#n_notes');
  const nBrand = $('#n_brand');
  const nName = $('#n_name');
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function genDescription() {
    const brand = nBrand.value.trim();
    const name = nName.value.trim();
    const notes = nNotes.value.trim();
    if (!brand || !name || !notes) return;
    const noteList = notes.split(/[·,|/]\s*/).map(n => n.trim()).filter(Boolean);
    const a = noteList[0] || ''; const b = noteList[1] || '';
    const c = noteList[2] || ''; const d = noteList[3] || '';
    const intro = pick([
      `${brand} presents ${name}`,
      `${name} by ${brand}`,
      `${brand}'s ${name}`,
      `${brand} introduces ${name}`,
      `With ${name}, ${brand}`,
      `${name} — the latest from ${brand}`,
      `${pick(['From', 'By'])} ${brand}, ${name}`,
      `${brand} unveils ${name}`,
    ]);
    const structures = [
      `${intro} — a fragrance shaped by ${a}${b ? `, ${b}` : ''}${c ? `, and ${c}` : ''}.${d ? ` Traces of ${d} linger beneath.` : ''} ${pick(['Bold yet refined.', 'Effortlessly elegant.', 'Modern, distinctive, unforgettable.', 'A quiet statement of taste.', 'Undeniably captivating.'])}`,
      `${intro} opens with ${a}${b ? `, unfurls through ${b}` : ''}${c ? `, and settles into ${c}` : ''}.${d ? ` A whisper of ${d} rounds out the composition.` : ''} ${pick(['A fragrance of remarkable depth.', 'A scent that lingers long after you leave.', 'Sophisticated, warm, and impossibly alluring.', 'Made for those who notice what others miss.'])}`,
      `There is something unmistakable about ${name}. ${cap(a)}${b ? `, ${b}` : ''}${c ? `, and ${c}` : ''} come together in a way that feels both deliberate and effortless.${d ? ` A touch of ${d} ties it all together.` : ''} ${pick(['This is ${brand} at its finest.', 'A fragrance that stays with you.', 'Wear it and be remembered.', 'Understated power, bottled.'])}`,
      `${pick(['A masterful blend from', 'An exquisite composition by', 'A captivating creation from'])} ${brand}. ${cap(name)} weaves${b ? ` ${a} with ${b}` : ` ${a}`}${c ? `, grounded by ${c}` : ''}${d ? `, with ${d} in the shadows` : ''} — ${pick(['a study in balance.', 'an exercise in restrained luxury.', 'a fragrance that demands nothing and gives everything.', 'a modern classic in the making.'])}`,
      `${cap(a)}${b ? `, ${b}` : ''}${c ? `, ${c}` : ''}${d ? `, ${d}` : ''} — these are the notes that define ${name}. ${brand} ${pick(['orchestrates them', 'weaves them', 'layers them', 'balances them'])} with ${pick(['remarkable precision', 'understated mastery', 'unmistakable artistry', 'effortless sophistication'])}, creating a scent that ${pick(['feels both timeless and new', 'commands attention without asking for it', 'stays with you', 'reveals something new with every wear'])}.`,
      `${name} is ${brand} at its most ${pick(['audacious', 'refined', 'unexpected', 'captivating'])}, with ${pick(['a core of', 'a heart built around', 'an interplay of', 'a striking contrast between'])} ${a}${b ? ` and ${b}` : ''}${c ? `, tempered by ${c}` : ''}.${d ? ` ${cap(d)} threads through it all.` : ''} ${pick(['Unforgettable.', 'Absolutely magnetic.', 'Pure elegance.', 'A masterstroke.'])}`,
      `Let ${a}${b ? ` and ${b}` : ''}${c ? `, and ${c}` : ''}${d ? `, and ${d}` : ''} wash over you. ${name} by ${brand} is a ${pick(['meditation on contrast', 'celebration of complexity', 'masterclass in restraint', 'journey through texture'])} — ${pick(['warm, complex, endlessly intriguing.', 'layered, compelling, instantly iconic.', 'subtle, powerful, achingly beautiful.', 'daring, refined, utterly unique.'])}`,
      `${brand} has done something remarkable with ${name}. ${cap(a)}${b ? `, ${b}` : ''}${c ? `, ${c}` : ''}${d ? `, and ${d}` : ''} are not just notes — they are ${pick(['moments', 'moods', 'memories', 'impressions'])}, ${pick(['woven together into something', 'stacked and layered into something', 'carefully composed into something'])} ${pick(['indescribably beautiful.', 'quietly powerful.', 'impossibly elegant.', 'wholly original.'])}`,
      `The genius of ${name} lies in its restraint. ${cap(a)}${b ? ` whispers against ${b}` : ''}${c ? `, while ${c} grounds it` : ''}${d ? `. ${cap(d)} appears only in the far dry-down` : ''}. ${pick(['The result is pure sophistication.', 'This is fragrance as haute couture.', 'A lesson in less being more.', 'Effortless, elegant, unforgettable.'])}`,
      `${name} by ${brand} doesn't ask for attention — it ${pick(['commands it', 'earns it', 'deserves it', 'captures it'])}, ${pick(['effortlessly', 'quietly', 'naturally', 'unapologetically'])}. ${cap(a)}${b ? ` and ${b}` : ''}${c ? `, with ${c}` : ''}${d ? ` and ${d}` : ''} ${pick(['unfold on the skin like a story.', 'reveal themselves slowly, deliberately.', 'create an aura that is impossible to ignore.', 'leave a trail that begs for compliments.'])}`,
      `${pick(['Close your eyes and you are there:', 'One breath and it takes you somewhere:', 'Spray once and the story begins:'])} ${a}${b ? `, then ${b}` : ''}${c ? `, then ${c}` : ''}${d ? `, and finally ${d}` : ''}. ${name} by ${brand} is ${pick(['a journey in a bottle.', 'a portrait painted in scent.', 'a memory waiting to be made.', 'a poem you can wear.'])}`,
      `Some fragrances are worn. ${name} is experienced. ${cap(a)}${b ? `, ${b}` : ''}${c ? `, ${c}` : ''}${d ? `, ${d}` : ''} — each ${pick(['layer', 'note', 'accord'])} ${pick(['unfolds with intention.', 'reveals a new facet.', 'builds on the last.', 'lingers just long enough.'])} ${brand} has created ${pick(['something truly special.', 'a modern icon.', 'a fragrance for the ages.', 'an instant classic.'])}`,
      `${name} is a ${pick(['love letter', 'tribute', 'nod', 'return'])} to the art of fine perfumery. ${cap(a)}${b ? ` meets ${b}` : ''}${c ? `, tempered by ${c}` : ''}${d ? `, finished with ${d}` : ''}. ${pick(['It is', 'The result is'])} ${pick(['impeccably balanced.', 'daringly elegant.', 'quietly revolutionary.', 'absolutely unforgettable.'])}`,
      `${brand}'s ${name} proves that ${pick(['true elegance never shouts.', 'the best things are worth waiting for.', 'complexity can feel effortless.', 'restraint is the ultimate luxury.'])} ${cap(a)}${b ? `, ${b}` : ''}${c ? `, ${c}` : ''}${d ? `, and ${d}` : ''} work in ${pick(['perfect harmony', 'stunning unison', 'deliberate balance', 'quiet conversation'])}, ${pick(['creating something', 'resulting in something', 'producing something'])} ${pick(['far greater than the sum of its parts.', 'that lingers in both memory and air.', 'that feels both new and eternally familiar.', 'that defines a moment, a mood, a self.'])}`,
      `${cap(a)}${b ? `, ${b}` : ''}${c ? `, ${c}` : ''}${d ? `, ${d}` : ''} — ${pick(['an unlikely combination', 'a inspired pairing', 'a masterful selection', 'a deliberate choice'])} from ${brand}. In ${name}, they ${pick(['collide beautifully', 'converge effortlessly', 'dance together', 'find perfect balance'])}, ${pick(['leaving a trail that is impossible to forget.', 'creating a scent that is greater than the sum of its parts.', 'revealing a fragrance of extraordinary depth and nuance.', 'marking a new chapter in the storied legacy of the house.'])}`,
      `${name} is not just a fragrance. It is ${pick(['an attitude.', 'a mood.', 'a signature.', 'a statement.'])} ${brand} captures this through ${a}${b ? `, ${b}` : ''}${c ? `, and ${c}` : ''}${d ? `, with ${d} in the wings` : ''} — ${pick(['confident, warm, unforgettable.', 'bold, nuanced, utterly compelling.', 'refined, daring, impossibly elegant.', 'modern, grounded, quietly powerful.'])}`,
      `${pick(['With', 'Through'])} ${name}, ${brand} ${pick(['reimagines', 'redefines', 'revisits', 'reinvents'])} what a fragrance can be. ${cap(a)}${b ? ` and ${b}` : ''}${c ? `, and ${c}` : ''}${d ? `, and ${d}` : ''} are the ${pick(['building blocks', 'foundation', 'heart', 'soul'])} of a composition that is ${pick(['startlingly original.', 'deeply evocative.', 'stunningly cohesive.', 'quietly radical.'])}`,
      `There are fragrances you wear. And then there is ${name}. ${cap(a)}${b ? `, ${b}` : ''}${c ? `, ${c}` : ''}${d ? `, ${d}` : ''} — ${pick(['it sits on the skin like a second self,', 'it announces itself without apology,', 'it unfolds in layers, each more compelling than the last,', 'it lingers like a half-remembered dream,'])} ${pick(['demanding to be noticed.', 'inviting closer inspection.', 'refusing to be forgotten.', 'begging for one more breath.'])}`,
      `What makes ${name} extraordinary? ${cap(a)}${b ? ` The way it meets ${b}` : ''}${c ? `, the way ${c} holds it together` : ''}${d ? `, the way ${d} catches you off guard` : ''}. ${brand} has ${pick(['crafted', 'built', 'composed', 'engineered'])} a fragrance that ${pick(['feels deeply personal.', 'is simultaneously bold and tender.', 'honors tradition while forging its own path.', 'is as complex as the person who wears it.'])}`,
      `${name} is a study in ${pick(['light and shadow.', 'warmth and coolness.', 'familiarity and surprise.', 'strength and softness.'])} On one side, ${a}${b ? `; on the other, ${b}` : ''}${c ? `; somewhere in between, ${c}` : ''}${d ? `; and always, ${d}` : ''}. ${brand} ${pick(['balances these forces', 'holds these tensions', 'weaves these opposites'])} with ${pick(['extraordinary grace.', 'unmistakable skill.', 'quiet confidence.', 'absolute mastery.'])}`,
    ];
    nDesc.value = structures.reduce((acc, s) => acc.replace(/\$\{(\w+)\}/g, (_, k) => ({ brand, name, a, b, c, d }[k] || '')), pick(structures));
    nDesc.value = cap(nDesc.value);
  }
  nNotes.addEventListener('blur', () => { if (!nDesc.value.trim()) genDescription(); });
  nBrand.addEventListener('blur', () => { if (!nDesc.value.trim()) genDescription(); });
  $('#nRegen').onclick = genDescription;
  async function handleNewFile(f) {
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Not an image file');
    if (f.size > 8 * 1024 * 1024) return toast('Image too large (max 8MB)');
    setNewImg(await fileToDataUrl(f));
  }
  async function handleNewUrl(url) {
    if (url) setNewImg(url);
  }
  nDrop.onclick = () => nFileIn.click();
  nClear.onclick = clearNewImg;
  nFileIn.onchange = () => handleNewFile(nFileIn.files[0]);
  // drag & drop
  nDrop.addEventListener('dragenter', (e) => { e.preventDefault(); nDrop.classList.add('dragover'); });
  nDrop.addEventListener('dragover', (e) => { e.preventDefault(); nDrop.classList.add('dragover'); });
  nDrop.addEventListener('dragleave', () => nDrop.classList.remove('dragover'));
  nDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    nDrop.classList.remove('dragover');
    const dt = e.dataTransfer;
    if (dt.files && dt.files.length) return handleNewFile(dt.files[0]);
    const url = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (url && /^https?:\/\//i.test(url)) return handleNewUrl(url);
  });
  // paste
  nDrop.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type.startsWith('image/')) { e.preventDefault(); return handleNewFile(it.getAsFile()); }
    }
  });

  $('#saveGithub').onclick = async () => {
    const btn = $('#saveGithub');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const r = await api('/api/admin/save', { method: 'POST' });
      btn.textContent = '✓ Saved to GitHub';
      toast('Saved to GitHub — data is now safe across cold starts');
      setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 3000);
    } catch (e) {
      btn.textContent = '× Save failed';
      toast(e.message);
      setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 3000);
    }
  };

  $('#addProduct').onclick = async () => {
    const body = {
      name: $('#n_name').value.trim(),
      brand: $('#n_brand').value.trim(),
      notes: $('#n_notes').value.trim(),
      size: $('#n_size').value.trim(),
      description: $('#n_desc').value.trim(),
      accent: '#b8975a',
      price: Math.round(parseFloat($('#n_price').value || '0') * 100),
    };
    if (!body.name || !body.brand || !body.price) return toast('Name, brand and price required');
    try {
      const p = await api('/api/admin/products', { method: 'POST', body });
      if (_newImgDataUrl) {
        await api(`/api/admin/products/${p.id}/image`, { method: 'POST', body: { dataUrl: _newImgDataUrl } });
        _newImgDataUrl = null;
      }
      // re-fetch and re-render the table so it's always in sync with server
      const fresh = await api('/api/admin/products');
      state.products = fresh;
      renderAdminTable(fresh);
      $('#n_name').value = ''; $('#n_brand').value = ''; $('#n_notes').value = ''; $('#n_size').value = ''; $('#n_desc').value = ''; $('#n_price').value = '';
      clearNewImg();
      toast('Fragrance added');
      api('/api/admin/save', { method: 'POST' }).catch(() => {});
    } catch (e) { toast(e.message); }
  };

  function bindRow(tr) {
    const id = tr.dataset.id;
    tr.querySelector('.save').onclick = async () => {
      const body = {};
      tr.querySelectorAll('input[data-f]').forEach((i) => {
        const f = i.dataset.f;
        if (f === 'price') body.price = Math.round(parseFloat(i.value || '0') * 100);
        else if (f === 'stock') body.stock = parseInt(i.value || '0', 10) || 0;
        else body[f] = i.value;
      });
      try {
        const updated = await api('/api/admin/products/' + id, { method: 'PUT', body });
        state.products = state.products.map(p => p.id == id ? updated : p);
        toast('Saved ✓');
        api('/api/admin/save', { method: 'POST' }).catch(() => {});
      } catch (e) { toast(e.message); }
    };
    tr.querySelector('.del').onclick = async () => {
      if (!confirm('Delete this fragrance?')) return;
      await api('/api/admin/products/' + id, { method: 'DELETE' });
      tr.remove();
      state.products = state.products.filter(p => p.id != id);
      toast('Deleted');
      api('/api/admin/save', { method: 'POST' }).catch(() => {});
    };
    // image upload handlers (same as below)
    const fileIn = tr.querySelector('.file-in');
    const uploadBtn = tr.querySelector('.upload');
    const thumb = tr.querySelector('.img-thumb');
    const busy = (on) => { uploadBtn.textContent = on ? 'Working…' : 'Upload'; thumb.classList.toggle('uploading', on); };
    async function updateThumb(product) {
      state.products = state.products.map(p => p.id == product.id ? product : p);
      thumb.innerHTML = product.image
        ? `<img class="thumb-img" src="${product.image}" alt=""/>`
        : `<span class="drop-hint">drop / paste</span>`;
      if (!product.image) thumb.style.background = `linear-gradient(160deg,${product.accent || '#b8975a'},#0c0c0e)`;
      busy(false);
      toast('Image saved ✓');
    }
    async function uploadFile(file) {
      if (!file) return;
      if (!/^image\//.test(file.type)) return toast('That is not an image file');
      if (file.size > 8 * 1024 * 1024) return toast('Image too large (max 8MB)');
      busy(true);
      try {
        const dataUrl = await fileToDataUrl(file);
        const p = await api(`/api/admin/products/${id}/image`, { method: 'POST', body: { dataUrl } });
        await updateThumb(p);
      } catch (e) { toast(e.message); busy(false); }
    }
    async function uploadUrl(url) {
      if (!url) return;
      busy(true);
      try {
        const p = await api(`/api/admin/products/${id}/image-url`, { method: 'POST', body: { url } });
        await updateThumb(p);
      } catch (e) { toast(e.message); busy(false); }
    }
    uploadBtn.onclick = () => fileIn.click();
    thumb.onclick = () => fileIn.click();
    fileIn.onchange = () => uploadFile(fileIn.files[0]);
    ['dragenter', 'dragover'].forEach((ev) =>
      thumb.addEventListener(ev, (e) => { e.preventDefault(); thumb.classList.add('drag'); }));
    ['dragleave', 'dragend'].forEach((ev) =>
      thumb.addEventListener(ev, () => thumb.classList.remove('drag')));
    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      thumb.classList.remove('drag');
      const dt = e.dataTransfer;
      if (dt.files && dt.files.length) return uploadFile(dt.files[0]);
      const url = dt.getData('text/uri-list') || dt.getData('text/plain');
      const html = dt.getData('text/html');
      if (html) {
        const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) return uploadUrl(m[1]);
      }
      if (url) return uploadUrl(url);
      toast('Could not read that image — try saving it and uploading the file');
    });
    thumb.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith('image/')) { e.preventDefault(); return uploadFile(it.getAsFile()); }
      }
      const text = e.clipboardData?.getData('text');
      if (text && /^https?:\/\//i.test(text)) { e.preventDefault(); return uploadUrl(text); }
    });
  }

  // attach admin order handlers here so they run once per renderAdmin()
  const ordersSection = $('#view');
  if (ordersSection) {
    ordersSection.querySelectorAll('[data-mark-paid]').forEach((b) => b.onclick = async () => {
      const id = +b.dataset.markPaid;
      try {
        await api(`/api/admin/orders/${id}/paid`, { method: 'POST' });
        b.closest('tr').querySelector('td:nth-child(5)').textContent = 'paid';
        b.replaceWith(`<button class="btn-admin btn-admin-pending" data-mark-pending="${id}">Mark pending</button>`);
        toast('Marked paid');
        const cfg = await api('/api/config'); state.pending_orders_count = cfg.pending_orders_count || 0; renderAdminBadge();
      } catch (err) { toast(err.message); }
    });
    ordersSection.querySelectorAll('[data-mark-pending]').forEach((b) => b.onclick = async () => {
      const id = +b.dataset.markPending;
      try {
        await api(`/api/admin/orders/${id}/pending`, { method: 'POST' });
        b.closest('tr').querySelector('td:nth-child(5)').textContent = 'pending';
        b.replaceWith(`<button class="btn-admin btn-admin-paid" data-mark-paid="${id}">Mark paid</button>`);
        toast('Marked pending');
        const cfg = await api('/api/config'); state.pending_orders_count = cfg.pending_orders_count || 0; renderAdminBadge();
      } catch (err) { toast(err.message); }
    });
    ordersSection.querySelectorAll('[data-del-order]').forEach((b) => b.onclick = async () => {
      const id = +b.dataset.delOrder;
      openConfirm({
        message: 'Delete this order? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: async () => {
          try {
            await api(`/api/admin/orders/${id}`, { method: 'DELETE' });
            b.closest('tr').remove();
            toast('Deleted');
            const cfg = await api('/api/config'); state.pending_orders_count = cfg.pending_orders_count || 0; renderAdminBadge();
          } catch (err) { toast(err.message); }
        }
      });
    });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ---------- global bindings ----------
function bindGlobal() {
  // stop the browser from opening an image file if it's dropped outside a dropzone
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (!e.target.closest('.img-thumb')) e.preventDefault();
  }));

  $('#cartBtn').onclick = openCart;
  $('#closeCart').onclick = closeCart;
  $('#overlay').onclick = () => { closeCart(); };
  $('#authBtn').onclick = () => state.user ? logout() : openAuth('login');
  $('#authClose').onclick = closeAuth;
  // click the dark backdrop (outside the modal box) to close
  $('#authModal').onclick = (e) => { if (e.target.id === 'authModal') closeAuth(); };
  // press Escape to close
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAuth(); closeCart(); closeQuickView(); } });
  $('#authForm').onsubmit = submitAuth;
  $('#switchLink').onclick = (e) => { e.preventDefault(); state.authMode = state.authMode === 'login' ? 'signup' : 'login'; applyAuthMode(); };

  // top navbar search dropdown
  $('#searchBtn').onclick = (e) => {
    e.stopPropagation();
    const panel = $('#searchPanel');
    if (panel.hidden) openSearchPanel(); else closeSearchPanel();
  };
  // typing only updates suggestions — does NOT filter the page yet
  $('#searchInput').oninput = (e) => { searchTempQuery = e.target.value; renderSearchResults(); };
  $('#searchInput').onkeydown = (e) => { if (e.key === 'Enter') applySearch(); };
  $('#searchApply').onclick = applySearch;
  $('#searchReset').onclick = () => {
    searchTempQuery = '';
    $('#searchInput').value = '';
    state.query = ''; state.brand = 'all';
    renderSearchResults(); updateSearchLabel();
    if (location.hash === '#shop' || location.hash === '') renderShop();
  };
  // keep panel open when clicking inside it
  $('#searchPanel').onclick = (e) => e.stopPropagation();
  document.addEventListener('click', (e) => { if (!e.target.closest('#navSearch')) closeSearchPanel(); });

  // mobile menu toggle
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  const mobileOverlay = $('#mobileOverlay');
  function toggleMenu(open) {
    menuToggle.classList.toggle('open', open);
    mobileMenu.classList.toggle('open', open);
    mobileOverlay.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }
  function closeMenu() { toggleMenu(false); }
  menuToggle.onclick = () => toggleMenu(!mobileMenu.classList.contains('open'));
  mobileOverlay.onclick = closeMenu;
  // favourites button → wishlist view
  $('#wishBtn').onclick = () => { location.hash = '#wishlist'; };

  $$('[data-link]').forEach((a) => a.onclick = (e) => { e.preventDefault(); location.hash = '#' + a.dataset.link; });
  // mobile menu links: override data-link handler — close menu first, then navigate
  mobileMenu.querySelectorAll('a').forEach(el => {
    el.onclick = (e) => { e.preventDefault(); closeMenu(); setTimeout(() => { location.hash = '#' + el.dataset.link; }, 150); };
  });
  // auth button in mobile menu: close menu then open auth / logout
  $('#authBtnMob').onclick = () => { closeMenu(); setTimeout(() => { state.user ? logout() : openAuth('login'); }, 150); };
  window.addEventListener('hashchange', route);
}

init();
