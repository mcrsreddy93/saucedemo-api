const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ========================================
// USERS & AUTH
// ========================================
const users = [
    { username: 'standard_user', password: 'secret_sauce', type: 'standard', role: 'user' },
    { username: 'locked_out_user', password: 'secret_sauce', type: 'locked', role: 'user' },
    { username: 'problem_user', password: 'secret_sauce', type: 'problem', role: 'user' },
    { username: 'performance_glitch_user', password: 'secret_sauce', type: 'performance', role: 'user' },
    { username: 'visual_user', password: 'secret_sauce', type: 'visual', role: 'user' },
    { username: 'error_user', password: 'secret_sauce', type: 'error', role: 'user' },
    { username: 'admin', password: 'admin123', role: 'admin' }, // ADMIN
];

// ========================================
// DYNAMIC INVENTORY & STOCK
// ========================================
let inventory = [
    { id: 0, name: 'Sauce Labs Bike Light', price: 9.99, img: 'bike-light-1200x1500.jpg' },
    { id: 1, name: 'Sauce Labs Bolt T-Shirt', price: 15.99, img: 'bolt-shirt-1200x1500.jpg' },
    { id: 2, name: 'Sauce Labs Onesie', price: 7.99, img: 'onesie-1200x1500.jpg' },
    { id: 3, name: 'Test.allTheThings() T-Shirt (Red)', price: 15.99, img: 'red-tatt-1200x1500.jpg' },
    { id: 4, name: 'Sauce Labs Backpack', price: 29.99, img: 'sauce-backpack-1200x1500.jpg' },
    { id: 5, name: 'Sauce Labs Fleece Jacket', price: 49.99, img: 'sauce-pullover-1200x1500.jpg' },
];

let nextProductId = 6;
const MAX_STOCK = 10;
const stock = new Map(); // productId → quantity
inventory.forEach(p => stock.set(p.id, MAX_STOCK));

const sessions = new Map();     // token → session
const orderHistory = [];
const validCoupons = { SAVE20: 0.20, TEST50: 0.50 };

// ========================================
// HELPERS & MIDDLEWARE
// ========================================
const getSession = (req) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return sessions.get(auth.split(' ')[1]) || null;
};

const requireAuth = (req, res, next) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Unauthorized' });
    req.session = s;
    next();
};

const requireAdmin = (req, res, next) => {
    const s = getSession(req);
    if (!s || s.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    req.session = s;
    next();
};

const calculateCartDetails = (cart, coupon = null) => {
    const items = cart.map(i => {
        const p = inventory.find(x => x.id === i.productId);
        if (!p) return null;
        return { productId: p.id, name: p.name, price: p.price, quantity: i.quantity, lineTotal: +(p.price * i.quantity).toFixed(2) };
    }).filter(Boolean);

    const itemTotal = +items.reduce((s, i) => s + i.lineTotal, 0).toFixed(2);
    const discount = coupon && validCoupons[coupon] ? +(itemTotal * validCoupons[coupon]).toFixed(2) : 0;
    const subtotal = +(itemTotal - discount).toFixed(2);
    const tax = +(subtotal * 0.08).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    return { items, itemTotal, discount, coupon: coupon || null, subtotal, tax, total };
};

// ========================================
// PUBLIC ROUTES
// ========================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '7.0 ULTIMATE', features: ['admin-crud-products', 'stock', 'coupons', 'order-history'] });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.type === 'locked') return res.status(403).json({ error: 'Sorry, this user has been locked out.' });
    if (user.type === 'performance') await new Promise(r => setTimeout(r, 2500));

    const token = randomUUID();
    sessions.set(token, {
        username: user.username,
        role: user.role || 'user',
        type: user.type || 'standard',
        cart: [],
        appliedCoupon: null,
        lastCheckout: null,
        loggedInAt: new Date().toISOString()
    });

    res.json({ token, user: { username, role: user.role || 'user' } });
});

app.post('/api/logout', requireAuth, (req, res) => {
    sessions.delete(req.headers.authorization.split(' ')[1]);
    res.json({ message: 'Logged out' });
});

// INVENTORY
app.get('/api/inventory', async (req, res) => {
    const session = getSession(req);
    if (session?.type === 'performance') await new Promise(r => setTimeout(r, 3000));

    const items = inventory.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        imageUrl: (session?.type === 'problem' || session?.type === 'visual')
            ? 'https://www.saucedemo.com/img/problem-user.jpg'
            : `https://www.saucedemo.com/img/${p.img}`,
        inStock: (stock.get(p.id) || 0) > 0,
        currentStock: session?.role === 'admin' ? stock.get(p.id) : undefined
    }));

    const { sort } = req.query;
    let sorted = [...items];
    if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'za') sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === 'lohi') sorted.sort((a, b) => a.price - b.price);
    if (sort === 'hilo') sorted.sort((a, b) => b.price - a.price);

    res.json(sorted);
});

app.get('/api/inventory/:id', (req, res) => {
    const p = inventory.find(x => x.id === Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Product not found' });
    res.json({ id: p.id, name: p.name, price: p.price, imageUrl: `https://www.saucedemo.com/img/${p.img}` });
});

// ========================================
// CART
// ========================================
app.get('/api/cart', requireAuth, (req, res) =>
    res.json(calculateCartDetails(req.session.cart, req.session.appliedCoupon))
);

app.post('/api/cart', requireAuth, (req, res) => {
    const { productId, quantity = 1 } = req.body;
    const id = Number(productId);
    const qty = Math.min(Number(quantity), 10);
    if (isNaN(id) || qty < 1) return res.status(400).json({ error: 'Invalid input' });

    const product = inventory.find(p => p.id === id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const available = stock.get(id) || 0;
    const current = req.session.cart.find(i => i.productId === id)?.quantity || 0;
    if (current + qty > available) return res.status(400).json({ error: 'Not enough stock', available });
    if (current + qty > 10) return res.status(400).json({ error: 'Max 10 per item' });

    const existing = req.session.cart.find(i => i.productId === id);
    if (existing) existing.quantity += qty;
    else req.session.cart.push({ productId: id, quantity: qty });

    res.status(201).json(calculateCartDetails(req.session.cart, req.session.appliedCoupon));
});

app.patch('/api/cart/:productId', requireAuth, (req, res) => {
    const id = Number(req.params.productId);
    const { quantity } = req.body;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
        return res.status(400).json({ error: 'Quantity 1–10' });

    const item = req.session.cart.find(i => i.productId === id);
    if (!item) return res.status(404).json({ error: 'Not in cart' });
    if (quantity > (stock.get(id) || 0)) return res.status(400).json({ error: 'Not enough stock' });

    item.quantity = quantity;
    res.json(calculateCartDetails(req.session.cart, req.session.appliedCoupon));
});

app.delete('/api/cart/:productId', requireAuth, (req, res) => {
    const id = Number(req.params.productId);
    const idx = req.session.cart.findIndex(i => i.productId === id);
    if (idx === -1) return res.status(404).json({ error: 'Not in cart' });
    if (req.session.cart[idx].quantity > 1) req.session.cart[idx].quantity--;
    else req.session.cart.splice(idx, 1);
    res.json(calculateCartDetails(req.session.cart, req.session.appliedCoupon));
});

app.post('/api/cart/reorder', requireAuth, (req, res) => {
    const { orderedProductIds } = req.body;
    if (!Array.isArray(orderedProductIds)) return res.status(400).json({ error: 'orderedProductIds array required' });

    const map = Object.fromEntries(req.session.cart.map(i => [i.productId, i]));
    const newCart = orderedProductIds.map(id => map[id]).filter(Boolean);
    if (newCart.length !== orderedProductIds.length) return res.status(400).json({ error: 'Invalid product ID' });

    req.session.cart = newCart.map(i => ({ productId: i.productId, quantity: i.quantity }));
    res.json(calculateCartDetails(req.session.cart, req.session.appliedCoupon));
});

app.post('/api/cart/coupon', requireAuth, (req, res) => {
    const { code } = req.body;
    if (!validCoupons[code]) {
        req.session.appliedCoupon = null;
        return res.status(400).json({ error: 'Invalid coupon' });
    }
    req.session.appliedCoupon = code;
    res.json({ message: 'Coupon applied', ...calculateCartDetails(req.session.cart, code) });
});

app.delete('/api/cart/coupon', requireAuth, (req, res) => {
    req.session.appliedCoupon = null;
    res.json(calculateCartDetails(req.session.cart));
});

// CHECKOUT
app.post('/api/checkout', requireAuth, async (req, res) => {
    const { firstName, lastName, postalCode } = req.body;
    if (!firstName || !lastName || !postalCode) return res.status(400).json({ error: 'All fields required' });
    if (!req.session.cart.length) return res.status(400).json({ error: 'Cart empty' });
    if (req.session.type === 'error') {
        await new Promise(r => setTimeout(r, 2000));
        return res.status(500).json({ error: 'Checkout failed (error_user)' });
    }

    // Deduct stock
    for (const item of req.session.cart) {
        stock.set(item.productId, stock.get(item.productId) - item.quantity);
    }

    const details = calculateCartDetails(req.session.cart, req.session.appliedCoupon);
    const order = {
        orderId: 'ORDER-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        username: req.session.username,
        customer: { firstName, lastName, postalCode },
        ...details,
        timestamp: new Date().toISOString()
    };

    orderHistory.push(order);
    req.session.lastCheckout = order;
    req.session.cart = [];
    req.session.appliedCoupon = null;

    res.status(201).json(order);
});

app.post('/api/reset', requireAuth, (req, res) => {
    req.session.cart = [];
    req.session.appliedCoupon = null;
    res.json({ message: 'App state reset' });
});

// ========================================
// ADMIN ROUTES
// ========================================
// Create product
app.post('/api/admin/products', requireAdmin, (req, res) => {
    const { name, price, img, initialStock = 10 } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 3)
        return res.status(400).json({ error: 'Valid name required' });
    if (!price || isNaN(price) || price <= 0)
        return res.status(400).json({ error: 'Valid price required' });
    if (!img || typeof img !== 'string')
        return res.status(400).json({ error: 'Image filename required' });

    const newProduct = {
        id: nextProductId++,
        name: name.trim(),
        price: Number(parseFloat(price).toFixed(2)),
        img: img.trim()
    };

    inventory.push(newProduct);
    stock.set(newProduct.id, Math.min(Math.max(0, initialStock), 100));

    res.status(201).json({
        message: 'Product created',
        product: { id: newProduct.id, name: newProduct.name, price: newProduct.price, imageUrl: `https://www.saucedemo.com/img/${newProduct.img}` }
    });
});

// Delete product
app.delete('/api/admin/products/:productId', requireAdmin, (req, res) => {
    const id = Number(req.params.productId);
    const idx = inventory.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Product not found' });

    // Safety: don't delete if in any cart
    const inUse = Array.from(sessions.values()).some(s => s.cart.some(i => i.productId === id));
    if (inUse) return res.status(409).json({ error: 'Product is in one or more carts – cannot delete' });

    const deleted = inventory.splice(idx, 1)[0];
    stock.delete(id);

    res.json({ message: 'Product deleted', deletedProduct: { id: deleted.id, name: deleted.name } });
});

// Stock management
app.get('/api/admin/stock', requireAdmin, (req, res) => {
    res.json(inventory.map(p => ({
        id: p.id,
        name: p.name,
        currentStock: stock.get(p.id) || 0
    })));
});

app.patch('/api/admin/stock/:productId', requireAdmin, (req, res) => {
    const id = Number(req.params.productId);
    const { quantity } = req.body;
    if (!inventory.some(p => p.id === id)) return res.status(404).json({ error: 'Not found' });
    if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ error: 'Invalid quantity' });
    stock.set(id, quantity);
    res.json({ message: 'Stock updated', productId: id, newStock: quantity });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
    res.json({ total: orderHistory.length, recent: orderHistory.slice(-20) });
});

// ========================================
// 404 & START
// ========================================
app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

app.listen(PORT, () => {
    console.log('\nSAUCDEMO API MOCK v7.0 — FULLY COMPLETE');
    console.log(`http://localhost:${PORT}`);
    console.log('Admin login: admin / admin123');
    console.log('Admin can CREATE and DELETE products!\n');
});