const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'msaadafund.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL,
    name TEXT, email TEXT,
    gender TEXT CHECK(gender IN ('me','ke','lingine')),
    age INTEGER, region TEXT,
    account_type TEXT DEFAULT 'mtu' CHECK(account_type IN ('mtu','ngo')),
    nida_number TEXT, nida_verified INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0, is_approved INTEGER DEFAULT 0,
    approval_status TEXT DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
    reject_reason TEXT, is_admin INTEGER DEFAULT 0, avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ngo_profiles (
    id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL,
    ngo_name TEXT NOT NULL, registration_number TEXT NOT NULL,
    ngo_type TEXT NOT NULL, region TEXT NOT NULL,
    description TEXT NOT NULL, representative_name TEXT NOT NULL,
    representative_phone TEXT NOT NULL, email TEXT,
    document_url TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    reject_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS otps (
    id TEXT PRIMARY KEY, phone TEXT NOT NULL, code TEXT NOT NULL,
    expires_at TEXT NOT NULL, used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('dharura','biashara','jamii')),
    goal_amount REAL NOT NULL CHECK(goal_amount >= 10000),
    raised_amount REAL DEFAULT 0, currency TEXT DEFAULT 'TZS',
    region TEXT NOT NULL, image_url TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','paused','completed','rejected')),
    reject_reason TEXT,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('mpesa','tigo','airtel','bank')),
    payment_account TEXT NOT NULL, bank_name TEXT, end_date TEXT,
    donor_count INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0,
    share_count INTEGER DEFAULT 0, featured INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS donations (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL,
    donor_user_id TEXT, donor_name TEXT, donor_phone TEXT,
    amount REAL NOT NULL CHECK(amount >= 500), currency TEXT DEFAULT 'TZS',
    payment_method TEXT NOT NULL, payment_reference TEXT,
    azampay_order_id TEXT, transaction_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','refunded')),
    message TEXT, is_anonymous INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_updates (
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
  CREATE INDEX IF NOT EXISTS idx_ngo_user ON ngo_profiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_type ON users(account_type);
`);
console.log('Hifadhidata imeunganishwa:', DB_PATH);
module.exports = db;
