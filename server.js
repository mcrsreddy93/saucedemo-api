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

// Users similar to SauceDemo
const users = [
    { username: 'standard_user', password: 'secret_sauce', type: 'standard' },
    { username: 'locked_out_user', password: 'secret_sauce', type: 'locked' },
    { username: 'problem_user', password: 'secret_sauce', type: 'problem' },
    { username: 'performance_glitch_user', password: 'secret_sauce', type: 'performance' },
];

// Inventory (6 items like SauceDemo, prices approximate)
const inventory = [
    {
        id: 0,
        name: 'Sauce Labs Bike Light',
        description: 'A red bike light that shines as bright as your test reports.',
        price: 9.99,
        imageUrl: 'https://www.saucedemo.com/img/bike-light-1200x1500.jpg',
    },
    {
        id: 1,
        name: 'Sauce Labs Bolt T-Shirt',
        description: 'Get supercharged with this bolt t-shirt.',
        price: 15.99,
        imageUrl: 'https://www.saucedemo.com/img/bolt-shirt-1200x1500.jpg',
    },
    {
        id: 2,
        name: 'Sauce Labs Onesie',
        description: 'Rib snap infant onesie for the junior automation engineer.',
        price: 7.99,
        imageUrl: 'https://www.saucedemo.com/img/onesie-1200x1500.jpg',
    },
    {
        id: 3,
        name: 'Test.allTheThings() T-Shirt (Red)',
        description: 'This classic tee will make you feel like a superhero tester.',
        price: 15.99,
        imageUrl: 'https://www.saucedemo.com/img/red-tatt-1200x1500.jpg',
    },
    {
        id: 4,
        name: 'Sauce Labs Backpack',
        description: 'Carry all your testing gear in style.',
        price: 29.99,
        imageUrl: 'https://www.saucedemo.com/img/sauce-backpack-1200x1500.jpg',
    },
    {
        id: 5,
        name: 'Sauce Labs Fleece Jacket',
        description: 'Keep warm while your tests run in the cloud.',
        price: 49.99,
        imageUrl: 'https://www.saucedemo.com/img/sauce-pullover-1200x1500.jpg',
    },
];

// Session storage: token -> { username, cart: [{ productId, quantity }], lastCheckout }
const sessions = new Map();

// ----------------------
// Helper functions
// ----------------------

function findUser(username, password) {
    return users.find(
        (u) => u.username === username && u.password === password
    );
}

function getSessionFromRequest(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

    const token = parts[1];
    return sessions.get(token) || null;
}

function calculateCartDetails(cart) {
    const items = cart.map((item) => {
        const product = inventory.find((p) => p.id === item.productId);
        if (!product) return null;

        const lineTotal = product.price * item.quantity;
        return {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: item.quantity,
            lineTotal: +lineTotal.toFixed(2),
        };
    }).filter(Boolean);

    const itemTotal = +items.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2);
    const tax = +(itemTotal * 0.08).toFixed(2); // 8% tax
    const total = +(itemTotal + tax).toFixed(2);

    return { items, itemTotal, tax, total };
}

// Auth middleware
function requireAuth(req, res, next) {
    const session = getSessionFromRequest(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
    }
    req.session = session;
    next();
}

// ----------------------
// Routes
// ----------------------

// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SauceDemo-like API running' });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
    }

    const user = findUser(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Username and password do not match any user in this service' });
    }

    // locked_out_user behaviour
    if (user.type === 'locked') {
        return res.status(403).json({ error: 'Sorry, this user has been locked out.' });
    }

    // performance_glitch_user behaviour – artificial delay
    if (user.type === 'performance') {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2s delay
    }

    const token = randomUUID();
    const session = {
        username: user.username,
        type: user.type,
        cart: [],
        lastCheckout: null,
    };
    sessions.set(token, session);

    res.json({
        token,
        user: {
            username: user.username,
            type: user.type,
        },
    });
});

// Inventory list with sorting
app.get('/api/inventory', (req, res) => {
    const { sort } = req.query;
    let items = [...inventory];

    if (sort === 'az') {
        items.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'za') {
        items.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sort === 'lohi') {
        items.sort((a, b) => a.price - b.price);
    } else if (sort === 'hilo') {
        items.sort((a, b) => b.price - a.price);
    }

    res.json(items);
});

// Single inventory item
app.get('/api/inventory/:id', (req, res) => {
    const id = Number(req.params.id);
    const product = inventory.find((p) => p.id === id);
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
});

// Get cart
app.get('/api/cart', requireAuth, (req, res) => {
    const { cart } = req.session;
    const details = calculateCartDetails(cart);
    res.json(details);
});

// Add to cart
app.post('/api/cart', requireAuth, (req, res) => {
    const { productId, quantity } = req.body || {};
    const id = Number(productId);
    const qty = quantity ? Number(quantity) : 1;

    if (Number.isNaN(id) || Number.isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid productId or quantity' });
    }

    const product = inventory.find((p) => p.id === id);
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }

    const existing = req.session.cart.find((item) => item.productId === id);
    if (existing) {
        existing.quantity += qty;
    } else {
        req.session.cart.push({ productId: id, quantity: qty });
    }

    const details = calculateCartDetails(req.session.cart);
    res.status(201).json(details);
});

// Remove from cart
app.delete('/api/cart/:productId', requireAuth, (req, res) => {
  const id = Number(req.params.productId);

  // Validate ID
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid productId' });
  }

  // Check if product exists in inventory
  const product = inventory.find((p) => p.id === id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const cart = req.session.cart;

  const index = cart.findIndex((item) => item.productId === id);

  if (index === -1) {
    // Not in cart
    return res.status(404).json({ error: 'Product not in cart' });
  }

  // Remove 1 item completely (just like remove button)
  cart.splice(index, 1);

  const details = calculateCartDetails(cart);

  return res.status(200).json({
    message: 'Item removed from cart',
    ...details
  });
});


// Reset app state (similar to "Reset App State" in burger menu)
app.post('/api/reset', requireAuth, (req, res) => {
    req.session.cart = [];
    req.session.lastCheckout = null;
    res.json({ message: 'App state reset for this user' });
});

// Checkout
app.post('/api/checkout', requireAuth, (req, res) => {
    const { firstName, lastName, postalCode } = req.body || {};
    if (!firstName || !lastName || !postalCode) {
        return res.status(400).json({ error: 'firstName, lastName and postalCode are required' });
    }

    if (!req.session.cart || req.session.cart.length === 0) {
        return res.status(400).json({ error: 'Cannot checkout with an empty cart' });
    }

    const details = calculateCartDetails(req.session.cart);
    const orderId = 'ORDER-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const summary = {
        orderId,
        customer: { firstName, lastName, postalCode },
        ...details,
    };

    // Clear cart after checkout, like real app
    req.session.lastCheckout = summary;
    req.session.cart = [];

    res.status(201).json(summary);
});

// Catch-all 404 for unknown API routes
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`SauceDemo-like API listening on http://localhost:${PORT}`);
});
