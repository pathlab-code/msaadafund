const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'msaadafund-secret-change-in-production';

// Require authentication
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unahitaji kuingia kwanza' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Mtumiaji hapatikani' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Tokeni si sahihi au imekwisha muda wake' });
  }
}

// Optional authentication (attach user if token present, continue either way)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    } catch {
      // ignore invalid token
    }
  }
  next();
}

// Require admin
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Ruhusa ya msimamizi inahitajika' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
