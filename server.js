const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ======================
// Fake Database + Stock
// ======================

const users = [
    { username: 'standard_user', password: 'secret_sauce', type: 'standard' },
    { username: 'locked_out_user', password: 'secret_sauce', type: 'locked' },
    { username: 'problem_user', password: 'secret_sauce', type: 'problem' },
    { username: 'performance_glitch_user', password: 'secret_sauce', type: 'performance' },
    { username: 'visual_user', password: 'secret_sauce', type: 'visual' },
    { username: 'error_user', password: 'secret_sauce', type: 'error' }, // always fails
];

const MAX_STOCK = 10;

const inventory = [
    { id: 0, name: 'Sauce Labs Bike Light', price: 9.99, img: 'bike-light-1200x1500.jpg' },
    { id: 1, name: 'Sauce Labs Bolt T-Shirt', price: 15.99, img: 'bolt-shirt-1200x1500.jpg' },
    { id: 2, name: 'Sauce Labs Onesie', price: 7.99, img: 'onesie-1200x1500.jpg' },
    { id: 3, name: 'Test.allTheThings() T-Shirt (Red)', price: 15.99, img: 'red-tatt-1200x1500.jpg' },
    { id: 4, name: 'Sauce Labs Backpack', price: 29.99, img: 'sauce-backpack-1200x1500.jpg' },
    { id: 5, name: 'Sauce Labs Fleece Jacket', price: 49.99, img: 'sauce-pullover-1200x1500.jpg' },
];

// Initial stock (shared across all sessions)
const stock = new Map();
inventory.forEach(p => stock.set(p.id, MAX_STOCK));


const sessions = new Map();

// ======================
// Coupons
// ======================

const coupons = {
    'SAVE20': 0.20,    // 20% off
    'FREESHIP': 0,     // placeholder
    'TEST50': 0.50,    // 50% off (for testing)
};

// ======================
// Helpers
// ======================

function getSession(req) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return sessions.get(auth.split(' ')[1]) || null;
}

function calculateCartDetails(cart, appliedCoupon = null) {
    const items = cart.map(i => {
        const p = inventory.find(x => x.id === i.productId);
        if (!p) return null;
        const lineTotal = +(p.price * i.quantity).toFixed(2);
        return { productId: p.id, name: p.name, price: p.price, quantity: i.quantity, lineTotal };
    }).filter(Boolean);

    let itemTotal = +items.reduce((s, i) => s + i.lineTotal, 0).toFixed(2);
    let discount = 0;
    let couponCode = null;

    if (appliedCoupon && coupons[appliedCoupon]) {
        discount = +(itemTotal * coupons[appliedCoupon]).toFixed(2);
        couponCode = appliedCoupon;
    }

    const subtotal = +(itemTotal - discount).toFixed(2);
    const tax = +(subtotal * 0.08).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    return { items, itemTotal, discount, couponCode, subtotal, tax, total };
}

function requireAuth(req, res, next) {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Unauthorized' });
    req.session = s;
    next();
}

// ======================
// Routes
// ======================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '3.0-ULTIMATE', features: ['stock', 'coupons', 'reorder', 'quantity-update'] });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.type === 'locked') return res.status(403).json({ error: 'Sorry, this user has been locked out.' });

    if (user.type === 'performance') await new Promise(r => setTimeout(r, 2500));

    const token = randomUUID();
    sessions.set(token, {
        username: user.username,
        type: user.type,
        cart: [],
        appliedCoupon: null,
        lastCheckout: null
    });

    res.json({ token, user: { username: user.username, type: user.type } });
});

// Inventory with stock + glitches
app.get('/api/inventory', async (req, res) => {
    const session = getSession(req);
    if (session?.type === 'performance') await new Promise(r => setTimeout(r, 3000));

    const items = inventory.map(p => {
        const inStock = stock.get(p.id) > 0;
        const imageUrl = (session?.type === 'problem' || session?.type === 'visual')
            ? 'https://www.saucedemo.com/img/problem-user.jpg'
            : `https://www.saucedemo.com/img/${p.img}`;

        return { id: p.id, name: p.name, price: p.price, imageUrl, inStock };
    });

    const { sort } = req.query;
    let sorted = [...items];
    if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'za') sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === 'lohi') sorted.sort((a, b) => a.price - b.price);
    if (sort === 'hilo') sorted.sort((a, b) => b.price - a.price);

    res.json(sorted);
});

// Cart Operations
app.get('/api/cart', requireAuth, (req, res) => {
    res.json(calculateCartDetails(req.session.cart, req.session.appliedCoupon));
});

app.post('/api/cart', requireAuth, (req, res) => {
    const { productId, quantity = 1 } = req.body;
    const id = Number(productId);
    const qty = Math.min(Number(quantity), 10); // max 10 per item

    if (isNaN(id) || qty < 1) return res.status(400).json({ error: 'Invalid input' });
    if (!inventory.some(p => p.id === id)) return res.status(404).json({ error: 'Product not found' });

    const currentStock = stock.get(id) || 0;
    const existing = req.session.cart.find(i => i.productId === id);
    const currentQty = existing?.quantity || 0;
    const needed = currentQty + qty;

    if (needed > currentStock) {
        return res.status(400).json({ error: 'Not enough stock', available: currentStock });
    }
    if (needed > 10) {
        return res.status(400).json({ error: 'Maximum 10 per item' });
    }

    if (existing) existing.quantity += qty;
    else req.session.cart.push({ productId: id, quantity: qty });

    res.status(201).json(calculateCartDetails(req.session.cart, req.session.appliedCoupon));
});

app.patch('/api/cart/:productId', requireAuth, (req, res) => {
    const id = Number(req.params.productId);
    const { quantity } = req.body;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return res.status(400).json({ error: 'Quantity must be 1–10' });
    }

    const item = req.session.cart.find(i => i.productId === id);
    if (!item) return res.status(404).json({ error: 'Not in cart' });

    const currentStock = stock.get(id);
    if (quantity > currentStock) {
        return res.status(400).json({ error: 'Not enough stock', available: currentStock });
    }

    item.quantity = quantity;
    res.json({ message: 'Quantity updated', ...calculateCartDetails(req.session.cart, req.session.appliedCoupon) });
});

app.delete('/api/cart/:productId', requireAuth, (req, res) => {
    const id = Number(req.params.productId);
    const index = req.session.cart.findIndex(i => i.productId === id);
    if (index === -1) return res.status(404).json({ error: 'Not in cart' });

    if (req.session.cart[index].quantity > 1) {
        req.session.cart[index].quantity--;
    } else {
        req.session.cart.splice(index, 1);
    }

    res.json({ message: 'Removed', ...calculateCartDetails(req.session.cart, req.session.appliedCoupon) });
});

app.post('/api/cart/reorder', requireAuth, (req, res) => {
    const { orderedProductIds } = req.body;
    if (!Array.isArray(orderedProductIds)) return res.status(400).json({ error: 'orderedProductIds array required' });

    const map = Object.fromEntries(req.session.cart.map(i => [i.productId, i]));
    const newCart = orderedProductIds.map(id => map[id]).filter(Boolean);

    if (newCart.length !== orderedProductIds.length) {
        return res.status(400).json({ error: 'Invalid product ID' });
    }

    req.session.cart = newCart.map(i => ({ productId: i.productId, quantity: i.quantity }));
    res.json({ message: 'Reordered', ...calculateCartDetails(req.session.cart, req.session.appliedCoupon) });
});

// Coupon
app.post('/api/cart/coupon', requireAuth, (req, res) => {
    const { code } = req.body;
    if (!code || !coupons[code]) {
        req.session.appliedCoupon = null;
        return res.status(400).json({ error: 'Invalid coupon code' });
    }

    req.session.appliedCoupon = code;
    res.json({ message: 'Coupon applied', coupon: code, ...calculateCartDetails(req.session.cart, code) });
});

app.delete('/api/cart/coupon', requireAuth, (req, res) => {
    req.session.appliedCoupon = null;
    res.json({ message: 'Coupon removed', ...calculateCartDetails(req.session.cart) });
});

// Checkout
app.post('/api/checkout', requireAuth, async (req, res) => {
    const { firstName, lastName, postalCode } = req.body;
    if (!firstName || !lastName || !postalCode) return res.status(400).json({ error: 'Missing fields' });
    if (!req.session.cart.length) return res.status(400).json({ error: 'Cart is empty' });

    // error_user always fails
    if (req.session.type === 'error') {
        await new Promise(r => setTimeout(r, 2000));
        return res.status(500).json({ error: 'Internal Server Error – Checkout failed (error_user behavior)' });
    }

    // Deduct stock
    for (const item of req.session.cart) {
        stock.set(item.productId, stock.get(item.productId) - item.quantity);
    }

    const details = calculateCartDetails(req.session.cart, req.session.appliedCoupon);
    const orderId = 'ORDER-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    const summary = { orderId, customer: { firstName, lastName, postalCode }, ...details };
    req.session.lastCheckout = summary;
    req.session.cart = [];
    req.session.appliedCoupon = null;

    res.status(201).json(summary);
});

app.post('/api/reset', requireAuth, (req, res) => {
    req.session.cart = [];
    req.session.appliedCoupon = null;
    res.json({ message: 'Reset complete' });
});

app.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization.split(' ')[1];
    sessions.delete(token);
    res.json({ message: 'Logged out' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Start
app.listen(PORT, () => {
    console.log('\nSauceDemo API Mock v3.0 – THE ULTIMATE TESTING BACKEND');
    console.log(`http://localhost:${PORT}`);
    console.log('Features: Stock, Coupons, Quantity Update, Reorder, Error User, Visual Bugs\n');
});