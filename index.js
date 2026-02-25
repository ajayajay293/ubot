const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// API Credentials (Fixed)
const API_ID = 31639742;
const API_HASH = '7c24cdee5f2b98ad27b0b8f0a07e566a';

// Store temporary clients
const tempClients = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  store: new MemoryStore({
      checkPeriod: 86400000
  }),
  secret: 'telegram-auth-secret-key-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { 
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
  }
}));

// Middleware to check auth
const requireAuth = (req, res, next) => {
  if (req.session.authenticated) {
      next();
  } else {
      res.redirect('/');
  }
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/home', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Step 1: Send Code
app.post('/api/send-code', async (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
  }

  try {
      const stringSession = new StringSession('');
      const client = new TelegramClient(stringSession, API_ID, API_HASH, {
          connectionRetries: 5,
      });

      await client.connect();
      
      const result = await client.sendCode({
          apiId: API_ID,
          apiHash: API_HASH,
          phoneNumber: phoneNumber,
      });

      // Store client and phone code hash temporarily
      const sessionId = Math.random().toString(36).substring(7);
      tempClients.set(sessionId, {
          client,
          phoneNumber,
          phoneCodeHash: result.phoneCodeHash,
          stringSession
      });

      req.session.sessionId = sessionId;
      req.session.phoneNumber = phoneNumber;

      res.json({ 
          success: true, 
          message: 'Code sent successfully',
          sessionId: sessionId
      });

  } catch (error) {
      console.error('Send code error:', error);
      res.status(500).json({ 
          error: error.message || 'Failed to send code' 
      });
  }
});

// Step 2: Verify Code
app.post('/api/verify-code', async (req, res) => {
  const { code, password } = req.body;
  const sessionId = req.session.sessionId;

  if (!sessionId || !tempClients.has(sessionId)) {
      return res.status(400).json({ error: 'Session expired. Please start over.' });
  }

  const tempData = tempClients.get(sessionId);
  const { client, phoneNumber, phoneCodeHash } = tempData;

  try {
      await client.invoke({
          _: 'auth.signIn',
          phoneNumber: phoneNumber,
          phoneCodeHash: phoneCodeHash,
          phoneCode: code,
      });

      // Get session string
      const sessionString = client.session.save();
      
      // Get user info
      const me = await client.getMe();

      // Clean up
      await client.disconnect();
      tempClients.delete(sessionId);

      // Set session
      req.session.authenticated = true;
      req.session.user = {
          id: me.id,
          firstName: me.firstName,
          lastName: me.lastName,
          username: me.username,
          phone: me.phone,
          sessionString: sessionString
      };

      res.json({
          success: true,
          message: 'Authentication successful',
          user: {
              id: me.id,
              firstName: me.firstName,
              lastName: me.lastName,
              username: me.username,
              phone: me.phone
          }
      });

  } catch (error) {
      // Handle 2FA password if needed
      if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          if (!password) {
              return res.status(401).json({ 
                  error: '2FA password required',
                  requirePassword: true 
              });
          }

          try {
              await client.invoke({
                  _: 'auth.checkPassword',
                  password: {
                      _: 'inputCheckPasswordSRP',
                      srpId: BigInt(0),
                      A: Buffer.from(password),
                      M1: Buffer.from(password)
                  }
              });
          } catch (passwordError) {
              return res.status(401).json({ error: 'Invalid 2FA password' });
          }
      } else {
          console.error('Verification error:', error);
          res.status(500).json({ 
              error: error.message || 'Invalid code' 
          });
      }
  }
});

// Get user info
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Telegram Userbot Login System`);
  console.log(`🔑 API ID: ${API_ID}`);
});
