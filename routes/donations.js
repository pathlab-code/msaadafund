const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { optionalAuth } = require('../middleware/auth');
const payments = require('../services/payments');
const smsService = require('../services/sms');

// POST /api/donations — initiate donation
router.post('/', optionalAuth, async (req, res) => {
  const {
    campaign_id, amount, payment_method,
    donor_phone, donor_name, message, is_anonymous,
  } = req.body;

  // Validate
  if (!campaign_id)   return res.status(400).json({ error: 'Kampeni inahitajika' });
  if (!amount || parseFloat(amount) < 500) return res.status(400).json({ error: 'Kiasi lazima kiwe angalau TZS 500' });
  if (!payment_method) return res.status(400).json({ error: 'Njia ya malipo inahitajika' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND status = ?').get(campaign_id, 'active');
  if (!campaign) return res.status(404).json({ error: 'Kampeni haipatikani au imefungwa' });

  // Bank donations are manual — just record as pending with instructions
  if (payment_method === 'bank') {
    const donationId = uuidv4();
    db.prepare(`
      INSERT INTO donations (id, campaign_id, donor_user_id, donor_name, donor_phone, amount, payment_method, status, message, is_anonymous)
      VALUES (?, ?, ?, ?, ?, ?, 'bank', 'pending', ?, ?)
    `).run(donationId, campaign_id, req.user?.id || null, donor_name?.trim() || null,
       donor_phone?.trim() || null, parseFloat(amount), message?.trim() || null, is_anonymous ? 1 : 0);

    return res.status(201).json({
      message: 'Tuma fedha kwa akaunti ya benki iliyoorodheshwa kwenye kampeni. Mchango wako utathibitishwa baada ya malipo kupokelewa.',
      donationId,
      bankDetails: {
        accountName:   campaign.title,
        accountNumber: campaign.payment_account,
        bankName:      campaign.bank_name || 'NMB / CRDB',
        reference:     `MSF-${donationId.slice(0, 8).toUpperCase()}`,
      },
    });
  }

  // Validate phone for mobile money
  const phoneRegex = /^(0[67]\d{8}|255[67]\d{8})$/;
  const phone = (donor_phone || req.user?.phone || '').replace(/\s/g, '');
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ error: 'Nambari ya simu inahitajika kwa malipo ya simu' });
  }
  const normalized = phone.replace(/^0/, '255');

  const orderId = `MSF-${uuidv4().slice(0, 16).toUpperCase()}`;
  const donationId = uuidv4();

  db.prepare(`
    INSERT INTO donations (id, campaign_id, donor_user_id, donor_name, donor_phone, amount, payment_method, azampay_order_id, status, message, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
  `).run(donationId, campaign_id, req.user?.id || null, donor_name?.trim() || null,
     normalized, parseFloat(amount), payment_method, orderId, message?.trim() || null, is_anonymous ? 1 : 0);

  try {
    const result = await payments.initiateMobilePayment({
      phone:       normalized,
      amount:      Math.round(parseFloat(amount)),
      provider:    payment_method,
      orderId,
      callbackUrl: `${process.env.APP_URL || 'http://localhost:3000'}/api/donations/callback`,
    });

    // In sandbox — auto-complete donation
    if (process.env.NODE_ENV !== 'production') {
      completeDonation(donationId, campaign_id, parseFloat(amount), orderId, result.transactionId);
    }

    res.status(201).json({
      message: 'Ombi la malipo limetumwa kwenye simu yako. Thibitisha kwa kuingiza PIN yako.',
      donationId,
      orderId,
      status: 'processing',
    });
  } catch (err) {
    console.error('Payment initiation error:', err.message);
    db.prepare('UPDATE donations SET status = ? WHERE id = ?').run('failed', donationId);
    res.status(502).json({ error: 'Malipo yameshindwa kuanzishwa. Jaribu tena.' });
  }
});

function completeDonation(donationId, campaignId, amount, orderId, transactionId) {
  db.prepare(`
    UPDATE donations SET status = 'completed', transaction_id = ?, payment_reference = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(transactionId || 'TXN-' + Date.now(), orderId, donationId);

  db.prepare(`
    UPDATE campaigns
    SET raised_amount = raised_amount + ?,
        donor_count   = donor_count + 1,
        status = CASE WHEN raised_amount + ? >= goal_amount THEN 'completed' ELSE status END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(amount, amount, campaignId);

  const donation  = db.prepare('SELECT * FROM donations WHERE id = ?').get(donationId);
  const campaign  = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (donation?.donor_phone && !donation.is_anonymous) {
    smsService.sendDonationConfirmation(donation.donor_phone, campaign.title, amount).catch(console.error);
  }
}

// POST /api/donations/callback — AzamPay payment callback webhook
router.post('/callback', express.raw({ type: '*/*' }), async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Log raw callback
  db.prepare('INSERT INTO payment_callbacks (id, provider, payload) VALUES (?, ?, ?)')
    .run(uuidv4(), 'azampay', JSON.stringify(payload));

  try {
    const parsed = payments.parseCallback(payload);
    const donation = parsed.orderId
      ? db.prepare('SELECT * FROM donations WHERE azampay_order_id = ?').get(parsed.orderId)
      : null;

    if (!donation) {
      console.warn('Callback for unknown order:', parsed.orderId);
      return res.json({ ok: true });
    }

    if (parsed.status === 'completed' && donation.status !== 'completed') {
      completeDonation(donation.id, donation.campaign_id, donation.amount, parsed.orderId, parsed.transactionId);
    } else if (parsed.status === 'failed') {
      db.prepare('UPDATE donations SET status = ? WHERE id = ?').run('failed', donation.id);
    }

    db.prepare('UPDATE payment_callbacks SET processed = 1, donation_id = ? WHERE payload LIKE ?')
      .run(donation.id, `%${parsed.orderId}%`);

    res.json({ ok: true });
  } catch (err) {
    console.error('Callback processing error:', err);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// GET /api/donations/:id/status — poll donation status
router.get('/:id/status', (req, res) => {
  const donation = db.prepare('SELECT id, status, campaign_id, amount, payment_method, created_at FROM donations WHERE id = ?').get(req.params.id);
  if (!donation) return res.status(404).json({ error: 'Mchango haujapatikani' });
  res.json({ data: donation });
});

// GET /api/donations/campaign/:id — public donations for a campaign
router.get('/campaign/:id', (req, res) => {
  const donations = db.prepare(`
    SELECT
      CASE WHEN is_anonymous = 1 THEN 'Mchango wa Siri' ELSE COALESCE(donor_name, 'Msaidizi') END as name,
      amount, message, created_at
    FROM donations
    WHERE campaign_id = ? AND status = 'completed'
    ORDER BY created_at DESC LIMIT 20
  `).all(req.params.id);
  res.json({ data: donations });
});

module.exports = router;
