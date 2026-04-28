require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');

// Initialize DB (creates tables + seeds dev data)
require('./db/database');

const app = express();

// ── Security ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:  process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Logging ─────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Body parsing ────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ───────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi sana. Tafadhali subiri dakika 15.' },
}));
app.use('/api/auth/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Majaribio mengi ya kuingia. Subiri dakika 15.' },
}));

// ── Static files ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploads with cache headers
const uploadsDir = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, {
  maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0,
  immutable: process.env.NODE_ENV === 'production',
}));

// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/donations', require('./routes/donations'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app:    process.env.APP_NAME || 'MsaadaFund',
    env:    process.env.NODE_ENV || 'development',
    time:   new Date().toISOString(),
  });
});

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `Picha ni kubwa sana. Kikomo ni ${process.env.MAX_FILE_SIZE_MB || 5}MB` });
  }
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Hitilafu ya seva. Tafadhali jaribu tena.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🇹🇿  MsaadaFund Server Imeanza       ║
╠════════════════════════════════════════╣
║  Port    : ${PORT}                        ║
║  Mazingira: ${(process.env.NODE_ENV || 'development').padEnd(27)}║
║  URL     : http://localhost:${PORT}       ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;
