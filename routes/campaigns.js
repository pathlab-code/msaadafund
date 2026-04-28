const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const smsService = require('../services/sms');

// Multer — image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_PATH || './uploads'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Picha tu zinakubaliwa (JPEG, PNG, WebP)'));
  },
});

const ALLOWED_REGIONS = [
  'Dar es Salaam','Mwanza','Arusha','Dodoma','Mbeya','Tanga',
  'Morogoro','Zanzibar','Kilimanjaro','Pwani','Lindi','Ruvuma',
  'Singida','Tabora','Rukwa','Kigoma','Shinyanga','Kagera',
  'Mara','Manyara','Njombe','Katavi','Simiyu','Geita','Songwe',
];
const ALLOWED_CATEGORIES = ['dharura','biashara','jamii'];
const ALLOWED_METHODS    = ['mpesa','tigo','airtel','bank'];

// GET /api/campaigns — list with filters + pagination
router.get('/', optionalAuth, (req, res) => {
  const { category, region, status = 'active', search, page = 1, limit = 12, featured } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limit));
  const params = [];
  const where  = [`c.status = ?`]; params.push(status);

  if (category && ALLOWED_CATEGORIES.includes(category)) { where.push('c.category = ?'); params.push(category); }
  if (region)   { where.push('c.region = ?');   params.push(region); }
  if (featured) { where.push('c.featured = 1'); }
  if (search)   {
    where.push('(c.title LIKE ? OR c.description LIKE ? OR c.region LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as c FROM campaigns c ${whereSQL}`).get(...params).c;
  const campaigns = db.prepare(`
    SELECT c.id, c.title, c.description, c.category, c.goal_amount, c.raised_amount,
           c.donor_count, c.region, c.image_url, c.status, c.end_date, c.created_at,
           c.featured, u.name as owner_name
    FROM campaigns c
    LEFT JOIN users u ON c.user_id = u.id
    ${whereSQL}
    ORDER BY c.featured DESC, c.created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `).all(...params);

  res.json({
    data: campaigns,
    meta: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// GET /api/campaigns/:id
router.get('/:id', optionalAuth, (req, res) => {
  const campaign = db.prepare(`
    SELECT c.*, u.name as owner_name, u.phone as owner_phone
    FROM campaigns c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampeni haijapatikana' });

  // Track views
  db.prepare('UPDATE campaigns SET view_count = view_count + 1 WHERE id = ?').run(campaign.id);

  const recentDonations = db.prepare(`
    SELECT donor_name, amount, is_anonymous, message, created_at
    FROM donations WHERE campaign_id = ? AND status = 'completed'
    ORDER BY created_at DESC LIMIT 10
  `).all(campaign.id);

  const updates = db.prepare('SELECT * FROM campaign_updates WHERE campaign_id = ? ORDER BY created_at DESC').all(campaign.id);

  // Mask owner phone for non-owners
  if (!req.user || req.user.id !== campaign.user_id) {
    campaign.owner_phone = campaign.owner_phone?.replace(/(\d{4})\d{4}(\d{2})/, '$1****$2');
  }

  res.json({ data: campaign, donations: recentDonations, updates });
});

// POST /api/campaigns — create campaign
router.post('/', requireAuth, upload.single('image'), (req, res) => {
  const { title, description, category, goal_amount, region, payment_method, payment_account, bank_name, end_date } = req.body;

  // Validate
  const errors = {};
  if (!title || title.trim().length < 5)             errors.title = 'Jina lazima liwe na herufi angalau 5';
  if (!description || description.trim().length < 30) errors.description = 'Maelezo lazima yawe na herufi angalau 30';
  if (!ALLOWED_CATEGORIES.includes(category))        errors.category = 'Aina ya kampeni si sahihi';
  if (!goal_amount || parseFloat(goal_amount) < 10000) errors.goal_amount = 'Kiasi lazima kiwe angalau TZS 10,000';
  if (!ALLOWED_REGIONS.includes(region))             errors.region = 'Mkoa haupatikani kwenye orodha';
  if (!ALLOWED_METHODS.includes(payment_method))     errors.payment_method = 'Njia ya malipo si sahihi';
  if (!payment_account || payment_account.trim().length < 6) errors.payment_account = 'Akaunti au nambari ya malipo inahitajika';

  if (Object.keys(errors).length) return res.status(400).json({ error: 'Tafadhali rekebisha makosa', errors });

  const id = uuidv4();
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

  db.prepare(`
    INSERT INTO campaigns (id, user_id, title, description, category, goal_amount, region,
      image_url, payment_method, payment_account, bank_name, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, title.trim(), description.trim(), category,
    parseFloat(goal_amount), region, imageUrl,
    payment_method, payment_account.trim(), bank_name?.trim() || null,
    end_date || null,
    process.env.NODE_ENV !== 'production' ? 'active' : 'pending'
  );

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);

  // Notify admin of new campaign (production)
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_PHONE) {
    smsService.sendSMS(process.env.ADMIN_PHONE, `MsaadaFund Admin: Kampeni mpya inasubiri ukaguzi: "${title}" na ${req.user.phone}`).catch(console.error);
  }

  res.status(201).json({ message: 'Kampeni imesajiliwa. Itapitiwa na timu yetu hivi karibuni.', data: campaign });
});

// PUT /api/campaigns/:id — update own campaign
router.put('/:id', requireAuth, upload.single('image'), (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampeni haijapatikana' });
  if (campaign.user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ error: 'Huna ruhusa ya kuhariri kampeni hii' });
  }

  const { title, description, end_date } = req.body;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : campaign.image_url;

  db.prepare(`
    UPDATE campaigns SET title = COALESCE(?, title), description = COALESCE(?, description),
      image_url = ?, end_date = COALESCE(?, end_date), updated_at = datetime('now') WHERE id = ?
  `).run(title?.trim() || null, description?.trim() || null, imageUrl, end_date || null, campaign.id);

  res.json({ message: 'Kampeni imesasishwa', data: db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.id) });
});

// POST /api/campaigns/:id/updates
router.post('/:id/updates', requireAuth, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampeni haijapatikana' });
  if (campaign.user_id !== req.user.id) return res.status(403).json({ error: 'Huna ruhusa' });

  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Kichwa na maudhui ya habari zinahitajika' });

  const id = uuidv4();
  db.prepare('INSERT INTO campaign_updates (id, campaign_id, title, body) VALUES (?, ?, ?, ?)').run(id, campaign.id, title.trim(), body.trim());

  // Notify recent donors
  const donorPhones = db.prepare(`
    SELECT DISTINCT donor_phone FROM donations
    WHERE campaign_id = ? AND status = 'completed' AND donor_phone IS NOT NULL LIMIT 100
  `).all(campaign.id).map(d => d.donor_phone);
  if (donorPhones.length) {
    smsService.sendCampaignUpdate(donorPhones, campaign.title, title).catch(console.error);
  }

  res.status(201).json({ message: 'Habari ya kampeni imechapishwa', id });
});

// POST /api/campaigns/:id/share (increment share count)
router.post('/:id/share', (req, res) => {
  db.prepare('UPDATE campaigns SET share_count = share_count + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/campaigns/my/list — authenticated user's campaigns
router.get('/my/list', requireAuth, (req, res) => {
  const campaigns = db.prepare(`
    SELECT *, (SELECT COUNT(*) FROM donations WHERE campaign_id = campaigns.id AND status = 'completed') as confirmed_donors
    FROM campaigns WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);
  res.json({ data: campaigns });
});

module.exports = router;
