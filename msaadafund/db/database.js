const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'msaadafund.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Performance + safety
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  -- ── Users ────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    phone       TEXT UNIQUE NOT NULL,
    name        TEXT,
    email       TEXT,
    avatar_url  TEXT,
    is_verified INTEGER DEFAULT 0,
    is_admin    INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- ── OTPs (phone verification) ─────────────────────────────────
  CREATE TABLE IF NOT EXISTS otps (
    id         TEXT PRIMARY KEY,
    phone      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ── Campaigns ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS campaigns (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    category         TEXT NOT NULL CHECK(category IN ('dharura','biashara','jamii')),
    goal_amount      REAL NOT NULL CHECK(goal_amount >= 10000),
    raised_amount    REAL DEFAULT 0,
    currency         TEXT DEFAULT 'TZS',
    region           TEXT NOT NULL,
    image_url        TEXT,
    status           TEXT DEFAULT 'pending'
                       CHECK(status IN ('pending','active','paused','completed','rejected')),
    reject_reason    TEXT,
    payment_method   TEXT NOT NULL CHECK(payment_method IN ('mpesa','tigo','airtel','bank')),
    payment_account  TEXT NOT NULL,
    bank_name        TEXT,
    end_date         TEXT,
    donor_count      INTEGER DEFAULT 0,
    view_count       INTEGER DEFAULT 0,
    share_count      INTEGER DEFAULT 0,
    featured         INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ── Donations ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS donations (
    id                 TEXT PRIMARY KEY,
    campaign_id        TEXT NOT NULL,
    donor_user_id      TEXT,
    donor_name         TEXT,
    donor_phone        TEXT,
    amount             REAL NOT NULL CHECK(amount >= 500),
    currency           TEXT DEFAULT 'TZS',
    payment_method     TEXT NOT NULL,
    payment_reference  TEXT,
    azampay_order_id   TEXT,
    transaction_id     TEXT,
    status             TEXT DEFAULT 'pending'
                         CHECK(status IN ('pending','processing','completed','failed','refunded')),
    message            TEXT,
    is_anonymous       INTEGER DEFAULT 0,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── Payment Callbacks ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS payment_callbacks (
    id          TEXT PRIMARY KEY,
    donation_id TEXT,
    provider    TEXT NOT NULL,
    payload     TEXT NOT NULL,
    processed   INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- ── Campaign Updates (campaign owner posts updates) ───────────
  CREATE TABLE IF NOT EXISTS campaign_updates (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  -- ── Indexes ───────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_campaigns_category  ON campaigns(category);
  CREATE INDEX IF NOT EXISTS idx_campaigns_status    ON campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_region    ON campaigns(region);
  CREATE INDEX IF NOT EXISTS idx_campaigns_user      ON campaigns(user_id);
  CREATE INDEX IF NOT EXISTS idx_donations_campaign  ON donations(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_donations_status    ON donations(status);
  CREATE INDEX IF NOT EXISTS idx_otps_phone          ON otps(phone);
`);

// Seed sample campaigns for development
const existing = db.prepare('SELECT COUNT(*) as c FROM campaigns').get();
if (existing.c === 0 && process.env.NODE_ENV !== 'production') {
  const { v4: uuidv4 } = require('uuid');
  const seedUser = db.prepare('SELECT id FROM users LIMIT 1').get();
  let uid = seedUser?.id;
  if (!uid) {
    uid = uuidv4();
    db.prepare('INSERT INTO users (id, phone, name, is_verified) VALUES (?,?,?,1)')
      .run(uid, '255712000001', 'Demo User');
  }
  const seeds = [
    ['Harusi ya Amina na Juma', 'dharura', 'Dar es Salaam', 5000000, 3200000, 145, 'mpesa', '0754123456', 'Amina na Juma wanapanga harusi yao Aprili 2025. Wanaitaji msaada wa kukusanya fedha za sherehe nzuri kwa familia na marafiki wao wapendwa wa muda mrefu.'],
    ['Ujenzi wa Darasa — Shule ya Mwambao', 'jamii', 'Bagamoyo', 20000000, 8500000, 312, 'tigo', '0713456789', 'Shule ya Mwambao ina uhitaji mkubwa wa darasa jipya. Wanafunzi 120 wanasoma nje bila kinga dhidi ya jua na mvua kila siku ya masomo.'],
    ['Matibabu ya Moyo — Maria Kileo', 'dharura', 'Mwanza', 8000000, 6100000, 89, 'airtel', '0688789012', 'Maria anahitaji upasuaji wa moyo haraka. Familia yake imekusanya kidogo lakini bado hawafiki kiasi kinachohitajika kwa operesheni.'],
    ['Biashara ya Mama Ntilie Arusha', 'biashara', 'Arusha', 3000000, 1800000, 67, 'mpesa', '0754234567', 'Mama Ntilie anataka kupanua biashara yake ya chakula. Anahitaji fedha za kununua vifaa vipya na kukodi nafasi kubwa zaidi katikati ya mji.'],
    ['Maji Safi — Mradi wa Ukonga', 'jamii', 'Dar es Salaam', 15000000, 12300000, 421, 'bank', '20271234567890', 'Kata ya Ukonga haina mfumo wa maji safi. Mradi huu utanufaisha familia zaidi ya 500 kwa maji salama ya kunywa kila siku bila wasiwasi.'],
    ['Bongo Innovation — Tech Hub DSM', 'biashara', 'Dar es Salaam', 50000000, 15000000, 203, 'mpesa', '0754345678', 'Kuunda nafasi ya kufanya kazi na kujifunza kwa vijana wa teknolojia DSM. Hub itakuwa na vifaa vya kisasa, internet ya kasi, na mafunzo ya biashara na coding.'],
  ];
  const insert = db.prepare(`
    INSERT INTO campaigns (id, user_id, title, description, category, goal_amount, raised_amount, donor_count, region, payment_method, payment_account, status, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', date('now', '+60 days'))
  `);
  for (const s of seeds) {
    insert.run(uuidv4(), uid, ...s);
  }
  console.log('✅ Kampeni za demo zimewekwa kwenye hifadhidata');
}

console.log('✅ Hifadhidata imeunganishwa:', DB_PATH);
module.exports = db;
