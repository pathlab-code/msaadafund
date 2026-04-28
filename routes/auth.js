const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const smsService = require('../services/sms');
const { requireAuth } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'msaadafund-secret-change-in-production';

function normalizePhone(phone) {
  return phone.replace(/[\s-]/g, '').replace(/^0/, '255').replace(/^\+/, '');
}

function isValidTanzaniaPhone(phone) {
  const normalized = normalizePhone(phone);
  return /^255[67]\d{8}$/.test(normalized);
}

function generateOTP() {
  if (process.env.NODE_ENV !== 'production') return '123456'; // Easy testing
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !isValidTanzaniaPhone(phone)) {
    return res.status(400).json({
      error: 'Nambari ya simu si sahihi. Mfano: 0712 345 678 au 0654 345 678',
    });
  }
  const normalized = normalizePhone(phone);

  // Rate limit: max 3 OTPs per 10 minutes
  const recent = db.prepare(`
    SELECT COUNT(*) as c FROM otps
    WHERE phone = ? AND created_at > datetime('now', '-10 minutes')
  `).get(normalized);
  if (recent.c >= 3) {
    return res.status(429).json({ error: 'Maombi mengi sana. Subiri dakika 10 kisha jaribu tena.' });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60000).toISOString();
  db.prepare('INSERT INTO otps (id, phone, code, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), normalized, otp, expiresAt);

  try {
    await smsService.sendOTP(normalized, otp);
    res.json({ message: 'Nambari ya uthibitisho imetumwa kwenye simu yako', phone: normalized });
  } catch (err) {
    console.error('SMS error:', err.message);
    // In dev, still respond with success so testing isn't blocked
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ message: `[DEV] OTP ni: ${otp}`, otp, phone: normalized });
    }
    res.status(500).json({ error: 'Imeshindwa kutuma SMS. Jaribu tena baadaye.' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
  const { phone, code, name } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Simu na nambari ya uthibitisho zinahitajika' });
  }
  const normalized = normalizePhone(phone);

  const otp = db.prepare(`
    SELECT * FROM otps
    WHERE phone = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(normalized, code);

  if (!otp) {
    return res.status(401).json({ error: 'Nambari ya uthibitisho si sahihi au imekwisha muda wake' });
  }
  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(otp.id);

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized);
  const isNew = !user;
  if (!user) {
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, phone, name, is_verified) VALUES (?, ?, ?, 1)').run(id, normalized, name || null);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } else {
    db.prepare('UPDATE users SET is_verified = 1, name = COALESCE(?, name), updated_at = datetime(\'now\') WHERE id = ?').run(name || null, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const token = jwt.sign({ userId: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    message: isNew ? 'Karibu MsaadaFund!' : 'Umeingia tena',
    token,
    isNew,
    user: { id: user.id, phone: user.phone, name: user.name, email: user.email },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const { id, phone, name, email, avatar_url, created_at } = req.user;
  const campaigns = db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE user_id = ?').get(id);
  const donated = db.prepare(`
    SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total
    FROM donations WHERE donor_user_id = ? AND status = 'completed'
  `).get(id);
  res.json({
    user: { id, phone, name, email, avatar_url, created_at },
    stats: { campaigns: campaigns.c, donations: donated.c, totalDonated: donated.total },
  });
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, (req, res) => {
  const { name, email } = req.body;
  if (name && name.trim().length < 2) {
    return res.status(400).json({ error: 'Jina lazima liwe na herufi angalau 2' });
  }
  db.prepare('UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), updated_at = datetime(\'now\') WHERE id = ?')
    .run(name?.trim() || null, email?.trim() || null, req.user.id);
  const updated = db.prepare('SELECT id, phone, name, email FROM users WHERE id = ?').get(req.user.id);
  res.json({ message: 'Wasifu umesasishwa', user: updated });
});

module.exports = router;
