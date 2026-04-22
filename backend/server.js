require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const authRoutes   = require('./routes/auth');
const surveyRoutes = require('./routes/survey');
const statsRoutes  = require('./routes/stats');
const aiRoutes     = require('./routes/ai');

const { authLimiter, contactLimiter, aiLimiter, globalLimiter } = require('./middleware/rateLimit');
const { isReady: redisReady, shutdown: redisShutdown } = require('./config/redis');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// Security + perf
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request timeout (30s)
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    if (!res.headersSent) res.status(503).json({ message: 'Request timeout' });
  });
  next();
});

// Global rate limit
app.use('/api/', globalLimiter);

// Static files
app.use(express.static(path.join(__dirname, '../frontend'), { maxAge: '1h' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// SEO Files
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, '../sitemap.xml'), err => {
    if (err) { console.error('[sitemap] Error:', err.message); res.status(404).end(); }
  });
});
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, '../robots.txt'), err => {
    if (err) { console.error('[robots] Error:', err.message); res.status(404).end(); }
  });
});

// API Routes
app.use('/api/auth',   authLimiter, authRoutes);
app.use('/auth',       authRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/stats',  statsRoutes);
app.use('/api/ai',     aiLimiter, aiRoutes);

app.post('/api/generate-images', aiLimiter, (req, res, next) => {
  req.url = '/generate-images';
  aiRoutes(req, res, next);
});

// Enhanced health check
app.get('/api/health', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = redisReady();
  const ok = mongoOk;

  res.status(ok ? 200 : 503).json({
    status:   ok ? 'ok' : 'degraded',
    service:  'Retlify API',
    pid:      process.pid,
    uptime:   Math.round(process.uptime()),
    mongo:    mongoOk ? 'connected' : 'disconnected',
    redis:    process.env.REDIS_URL ? (redisOk ? 'connected' : 'disconnected') : 'not configured',
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    time:     new Date().toISOString(),
  });
});

app.get('/api/ready', (req, res) => {
  if (mongoose.connection.readyState === 1) return res.status(200).send('ready');
  res.status(503).send('not ready');
});

// POST /api/contact
const { Resend } = require('resend');
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, timestamp } = req.body;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!name || name.trim().length < 2)         return res.status(400).json({ message: 'Invalid name.' });
    if (!email || !emailRe.test(email))           return res.status(400).json({ message: 'Invalid email.' });
    if (!message || message.trim().length < 10)   return res.status(400).json({ message: 'Message too short.' });

    const safe = s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    const safeTime = timestamp
      ? new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from:    'Retlify <onboarding@resend.dev>',
      to:      process.env.TO_EMAIL || 'utkarshverma8670@gmail.com',
      replyTo: email,
      subject: 'New Contact Form Submission - Retlify',
      html:    '<h2>New message from ' + safe(name) + '</h2>' +
               '<p><strong>Email:</strong> ' + safe(email) + '</p>' +
               '<p><strong>Message:</strong><br/>' + safe(message) + '</p>' +
               '<p><strong>Time:</strong> ' + safeTime + ' IST</p>'
    });
    console.log('[Contact] Email sent from ' + safe(email) + ' (' + safe(name) + ')');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Contact] Error:', err.message);
    res.status(500).json({ message: 'Failed to send message.' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/landing.html')));

const cleanPages = [
  'login', 'signup', 'survey', 'dashboard',
  'forgot-password', 'reset-password',
  'privacy-policy', 'contact', 'benefits',
  'ai-product-studio', 'product-studio',
  'ai-image-studio', 'image-generator-demo',
];
cleanPages.forEach(p => {
  app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, '../frontend/' + p + '.html')));
  app.get('/' + p + '.html', (req, res) => res.redirect(301, '/' + p));
});

app.get('/frontend/:page', (req, res) => {
  const page = req.params.page.replace('.html', '');
  if (page === 'landing') return res.redirect(301, '/');
  return res.redirect(301, '/' + page);
});

app.use('/api/*', (req, res) => res.status(404).json({ message: 'API route not found: ' + req.originalUrl }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error.' });
});

if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('REPLACE_USER')) {
  console.error('MONGO_URI is not set in your .env file.');
  process.exit(1);
}

let server;

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: parseInt(process.env.MONGO_POOL_SIZE || '50', 10),
  minPoolSize: 5,
})
  .then(() => {
    console.log('[mongo] connected (pool: ' + (process.env.MONGO_POOL_SIZE || '50') + ')');
    server = app.listen(PORT, () => {
      console.log('[server] Retlify worker ' + process.pid + ' -> http://localhost:' + PORT);
      console.log('[server] Survey emails -> ' + (process.env.TO_EMAIL || 'retlifyy@gmail.com'));
      if (!process.env.GOOGLE_CLIENT_ID) console.log('[server] Google OAuth: Add GOOGLE_CLIENT_ID to .env to enable');
      if (!process.env.SMTP_PASS || process.env.SMTP_PASS.includes('REPLACE'))
        console.log('[server] Email: Add SMTP_PASS to .env to enable survey emails');
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout   = 66000;
  })
  .catch(err => {
    console.error('[mongo] connection failed:', err.message);
    process.exit(1);
  });

async function shutdown(signal) {
  console.log('[server] ' + signal + ' received, shutting down worker ' + process.pid);

  if (server) {
    server.close(() => console.log('[server] http closed'));
  }

  setTimeout(async () => {
    try {
      await mongoose.connection.close();
      console.log('[mongo] connection closed');
    } catch (e) { console.error('[mongo] close error:', e.message); }

    try {
      await redisShutdown();
      console.log('[redis] closed');
    } catch (e) { console.error('[redis] close error:', e.message); }

    process.exit(0);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown('uncaughtException');
});

module.exports = app;
