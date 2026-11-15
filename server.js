const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = 'audiopulse_db';

let db = null;
let usersCollection = null;
let sessionsCollection = null;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Connect to MongoDB
async function initMongo() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    usersCollection = db.collection('users');
    sessionsCollection = db.collection('sessions');

    // Create unique index on username
    await usersCollection.createIndex({ username: 1 }, { unique: true });
    // Index on session token
    await sessionsCollection.createIndex({ token: 1 }, { unique: true });
    // TTL index to automatically expire sessions after 7 days
    await sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    console.log(`[MongoDB] Connected successfully to "${DB_NAME}"`);
  } catch (err) {
    console.error('[MongoDB] Connection error:', err);
    process.exit(1);
  }
}

// Authentication helper
async function getCurrentUser(req) {
  const token = req.cookies.auth_token;
  if (!token || !sessionsCollection) return null;

  const session = await sessionsCollection.findOne({
    token,
    expiresAt: { $gt: new Date() }
  });

  if (!session) return null;
  return { username: session.username, userId: session.userId };
}

/* =========================================================================
   AUTH API ROUTES
   ========================================================================= */

// 1. Sign Up
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const trimmedUser = username.trim();
    if (trimmedUser.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    // Check if user already exists
    const existing = await usersCollection.findOne({ username: trimmedUser });
    if (existing) {
      return res.status(400).json({ error: 'Username is already registered. Please log in.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await usersCollection.insertOne({
      username: trimmedUser,
      passwordHash,
      createdAt: new Date()
    });

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await sessionsCollection.insertOne({
      token,
      userId: result.insertedId,
      username: trimmedUser,
      createdAt: new Date(),
      expiresAt
    });

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      expires: expiresAt
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      user: { username: trimmedUser }
    });
  } catch (err) {
    console.error('Sign up error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// 2. Log In
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter both username and password.' });
    }

    const trimmedUser = username.trim();
    const user = await usersCollection.findOne({ username: trimmedUser });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Create new session
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await sessionsCollection.insertOne({
      token,
      userId: user._id,
      username: user.username,
      createdAt: new Date(),
      expiresAt
    });

    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      expires: expiresAt
    });

    return res.json({
      success: true,
      message: 'Logged in successfully.',
      user: { username: user.username }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// 3. Current User Check
app.get('/api/me', async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.json({ authenticated: false, user: null });
    }
    return res.json({ authenticated: true, user });
  } catch (err) {
    return res.json({ authenticated: false, user: null });
  }
});

// 4. Log Out
app.post('/api/logout', async (req, res) => {
  try {
    const token = req.cookies.auth_token;
    if (token && sessionsCollection) {
      await sessionsCollection.deleteOne({ token });
    }
    res.clearCookie('auth_token');
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.clearCookie('auth_token');
    return res.json({ success: true });
  }
});

// Protect index.html route: redirect unauthenticated users to /login.html
app.get('/', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Static assets (styles, js, login.html)
app.use(express.static(path.join(__dirname)));

// Start server
initMongo().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[AudioPulse Server] Running at http://127.0.0.1:${PORT}`);
  });
});
