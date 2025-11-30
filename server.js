const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ----------------------
// Fake "database"
// ----------------------

const users = [
    { username: 'standard_user', password: 'secret_sauce', type: 'standard' },
    { username: 'locked_out_user', password: 'secret_sauce', type: 'locked' },
    { username: 'problem_user', password: 'secret_sauce', type: 'problem' },
    { username: 'performance_glitch_user', password: 'secret_sauce', type: 'performance' },
    { username: 'error_user', password: 'secret_sauce', type: 'error' }, // extra for fun
    { username: 'visual_user', password: 'secret_sauce', type: 'visual' }, // extra for visual bugs
];

const inventory = [
    { id: 0, name: 'Sauce Labs Bike Light', desc: 'A red bike light...', price: 9.99, img: 'bike-light-1200x1500.jpg' },
    { id: 1, name: 'Sauce Labs Bolt T-Shirt', desc: 'Get supercharged...', price: 15.99, img: 'bolt-shirt-1200x1500.jpg' },
    { id: 2, name: 'Sauce Labs Onesie', desc: 'Rib snap infant onesie...', price: 7.99, img: 'onesie-1200x1500.jpg' },
    { id: 3, name: 'Test.allTheThings() T-Shirt (Red)', desc: 'This classic tee...', price: 15.99, img: 'red-tatt-1200x1500.jpg' },
    { id: 4, name: 'Sauce Labs Backpack', desc: 'Carry all your testing gear...', price: 29.99, img: 'sauce-backpack-1200x1500.jpg' },
    { id: 5, name: 'Sauce Labs Fleece Jacket', desc: 'Keep warm while your tests...', price: 49.99, img: 'sauce-pullover-1200x1500.jpg' },
];

// Session storage: token → session object
const sessions = new Map();

// ----------------------
// Helpers
// ----------------------

function findUser(username, password) {
    return users.find(u => u.username === username && u.password === password);
}

function getSessionFromRequest(req) {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.split(' ')[1];
    return sessions.get(token) || null;
}

function calculateCartDetails(cart) {
    const items = cart.map(item => {
        const product = inventory.find(p => p.id === item.productId);
        if (!product) return null;
        const lineTotal = +(product.price * item.quantity).toFixed(2);
        return {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: item.quantity,
            lineTotal,
        };
    }).filter(Boolean);

    const itemTotal = +items.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2);
    const tax = +(itemTotal * 0.08).toFixed(2);
    const total = +(itemTotal + tax).toFixed(2);

    return { items, itemTotal, tax, total };
}

// Auth middleware
function requireAuth(req, res, next) {
    const session = getSessionFromRequest(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.session = session;
    next();
}

// ----------------------
// Routes
// ----------------------

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SauceDemo API Mock v2 – Ready for testing!' });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
    }

    const user = findUser(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.type === 'locked') {
        return res.status(403).json({ error: 'Sorry, this user has been locked out.' });
    }

    // Performance glitch delay on login
    if (user.type === 'performance') {
        await new Promise(r => setTimeout(r, 2500));
    }

    const token = randomUUID();
    sessions.set(token, {
        username: user.username,
        type: user.type,
        cart: [],           // Always fresh cart on login (real behavior)
        lastCheckout: null,
    });

    res.json({ token, user: { username: user.username, type: user.type } });
});

// Logout
app.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization.split(' ')[1];
    sessions.delete(token);
    res.json({ message: 'Logged out' });
});

// Inventory – with sorting + problem/visual user image glitches
app.get('/api/inventory', async (req, res) => {
    const session = getSessionFromRequest(req);

    // Performance delay on inventory load
    if (session?.type === 'performance') {
        await new Promise(r => setTimeout(r, 3000));
    }

    let items = inventory.map(p => ({
        id: p.id,
        name: p.name,
        description: p.desc,
        price: p.price,
        imageUrl: `https://www.saucedemo.com/img/${p.img}`,
    }));

    // problem_user & visual_user get broken/wrong images
    if (session?.type === 'problem' || session?.type === 'visual') {
        items = items.map((item, i) => ({
            ...item,
            imageUrl: 'https://www.saucedemo.com/img/problem-user.jpg', // or random dog pics
        }));
    }

    const { sort } = req.query;
    if (sort === 'az') items.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'za') items.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === 'lohi') items.sort((a, b) => a.price - b.price);
    if (sort === 'hilo') items.sort((a, b) => b.price - a.price);

    res.json(items);
});

app.get('/api/inventory/:id', (req, res) => {
    const id = Number(req.params.id);
    const product = inventory.find(p => p.id === id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({
        id: product.id,
        name: product.name,
        description: product.desc,
        price: product.price,
        imageUrl: `https://www.saucedemo.com/img/${product.img}`,
    });
});

// Cart
app.get('/api/cart', requireAuth, (req, res) => {
    const details = calculateCartDetails(req.session.cart);
    res.json(details);
});

app.post('/api/cart', requireAuth, (req, res) => {
    const { productId, quantity = 1 } = req.body || {};
    const id = Number(productId);
    const qty = Number(quantity);

    if (isNaN(id) || isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid productId or quantity' });
    }

    if (!inventory.some(p => p.id === id)) {
        return res.status(404).json({ error: 'Product not found' });
    }

    const existing = req.session.cart.find(i => i.productId === id);
    if (existing) {
        existing.quantity += qty;
    } else {
        req.session.cart.push({ productId: id, quantity: qty });
    }

    res.status(201).json(calculateCartDetails(req.session.cart));
});

// Remove from cart – now correctly removes only 1 item (like real SauceDemo)
app.delete('/api/cart/:productId', requireAuth, (req, res) => {
    const id = Number(req.params.productId);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid productId' });

    const index = req.session.cart.findIndex(i => i.productId === id);
    if (index === -1) return res.status(404).json({ error: 'Item not in cart' });

    if (req.session.cart[index].quantity > 1) {
        req.session.cart[index].quantity -= 1;
    } else {
        req.session.cart.splice(index, 1);
    }

    res.json({
        message: 'Item removed from cart',
        ...calculateCartDetails(req.session.cart)
    });
});

// Reset app state
app.post('/api/reset', requireAuth, (req, res) => {
    req.session.cart = [];
    req.session.lastCheckout = null;
    res.json({ message: 'App state reset' });
});

// Checkout
app.post('/api/checkout', requireAuth, (req, res) => {
    const { firstName, lastName, postalCode } = req.body || {};
    if (!firstName || !lastName || !postalCode) {
        return res.status(400).json({ error: 'All customer fields required' });
    }

    if (req.session.cart.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
    }

    const details = calculateCartDetails(req.session.cart);
    const orderId = 'ORDER-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    const summary = {
        orderId,
        customer: { firstName, lastName, postalCode },
        ...details,
        message: 'Thank you for your order!',
        complete: true
    };

    req.session.lastCheckout = summary;
    req.session.cart = [];

    res.status(201).json(summary);
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Start
app.listen(PORT, () => {
    console.log(`SauceDemo API Mock (Perfect Clone) running on http://localhost:${PORT}`);
    console.log(`Try logging in with: standard_user / secret_sauce`);
});