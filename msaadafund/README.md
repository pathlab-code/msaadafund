# 🇹🇿 MsaadaFund — Tanzania Crowdfunding Platform

**Pamoja Tunaweza** — A production-ready crowdfunding platform built for Tanzania, supporting M-Pesa, Tigo Pesa, Airtel Money, and bank transfers.

---

## Features

- **Phone OTP Authentication** — Login with any Tanzania mobile number
- **Campaign Management** — Create, edit, and track crowdfunding campaigns
- **3 Campaign Types** — Dharura (emergency), Biashara (business), Jamii (community)
- **4 Payment Methods** — M-Pesa, Tigo Pesa, Airtel Money, Bank Transfer (via AzamPay)
- **Real-time Notifications** — SMS alerts via Africa's Talking
- **Image Uploads** — Campaign photos with auto-resize
- **Campaign Updates** — Owners can post progress updates
- **Donor Notifications** — Auto-SMS to donors and campaign owners
- **Admin Review Flow** — Campaigns require approval before going live
- **Rate Limiting & Security** — Helmet, CORS, rate limiter, JWT auth

---

## Tech Stack

| Layer      | Technology                             |
|------------|----------------------------------------|
| Backend    | Node.js + Express                      |
| Database   | SQLite (dev) / PostgreSQL (production) |
| Payments   | AzamPay (M-Pesa, Tigo, Airtel Money)  |
| SMS        | Africa's Talking                       |
| Auth       | JWT + Phone OTP                        |
| Frontend   | Vanilla HTML/CSS/JS (SPA)              |
| File Store | Local (`/uploads`) → swap for S3      |

---

## Quick Start

### 1. Install dependencies
```bash
cd msaadafund
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Start the server
```bash
# Development (with auto-reload + sandbox payments)
npm run dev

# Production
NODE_ENV=production npm start
```

Server starts at: **http://localhost:3000**

> In development, the database is seeded with 6 sample campaigns automatically.
> OTP code is always `123456` in development — no SMS needed for testing.

---

## Environment Variables

| Variable               | Required | Description                                    |
|------------------------|----------|------------------------------------------------|
| `PORT`                 | No       | Server port (default: 3000)                    |
| `NODE_ENV`             | No       | `development` or `production`                  |
| `JWT_SECRET`           | **YES**  | Long random string for signing tokens          |
| `AZAMPAY_CLIENT_ID`    | Prod     | AzamPay client ID                              |
| `AZAMPAY_CLIENT_SECRET`| Prod     | AzamPay client secret                          |
| `AZAMPAY_BASE_URL`     | No       | Sandbox or production AzamPay URL              |
| `AT_USERNAME`          | Prod     | Africa's Talking username                      |
| `AT_API_KEY`           | Prod     | Africa's Talking API key                       |
| `AT_SENDER_ID`         | No       | SMS sender name (default: MsaadaFund)          |
| `APP_URL`              | Prod     | Your production URL (for payment callbacks)    |
| `ADMIN_PHONE`          | No       | Admin phone for new campaign alerts            |

---

## Payment Integration

### AzamPay (Recommended)
AzamPay aggregates all Tanzania mobile money into one API.

1. Sign up at [developers.azampay.co.tz](https://developers.azampay.co.tz)
2. Get your `Client ID` and `Client Secret`
3. Set `AZAMPAY_BASE_URL=https://sandbox.azampay.co.tz` for testing
4. For production: `AZAMPAY_BASE_URL=https://api.azampay.co.tz`

**Callback URL** (set in AzamPay dashboard):
```
https://yourdomain.co.tz/api/donations/callback
```

### Africa's Talking (SMS)
1. Sign up at [africastalking.com](https://account.africastalking.com)
2. Tanzania is fully supported
3. Sandbox username: `sandbox`, any API key works for testing

---

## API Reference

### Auth
| Method | Endpoint               | Description                    |
|--------|------------------------|--------------------------------|
| POST   | `/api/auth/send-otp`   | Send OTP to phone              |
| POST   | `/api/auth/verify-otp` | Verify OTP, get JWT token      |
| GET    | `/api/auth/me`         | Get current user + stats       |
| PUT    | `/api/auth/profile`    | Update name/email              |

### Campaigns
| Method | Endpoint                          | Auth | Description          |
|--------|-----------------------------------|------|----------------------|
| GET    | `/api/campaigns`                  | No   | List campaigns       |
| GET    | `/api/campaigns/:id`              | No   | Get campaign details |
| POST   | `/api/campaigns`                  | Yes  | Create campaign      |
| PUT    | `/api/campaigns/:id`              | Yes  | Update campaign      |
| POST   | `/api/campaigns/:id/updates`      | Yes  | Post campaign update |
| GET    | `/api/campaigns/my/list`          | Yes  | My campaigns         |

**Query params for GET /campaigns:**
- `category` — `dharura`, `biashara`, or `jamii`
- `region` — Tanzanian region name
- `search` — Search in title/description
- `page`, `limit` — Pagination
- `featured=1` — Featured campaigns only

### Donations
| Method | Endpoint                       | Auth | Description            |
|--------|--------------------------------|------|------------------------|
| POST   | `/api/donations`               | No   | Initiate donation      |
| GET    | `/api/donations/:id/status`    | No   | Poll payment status    |
| GET    | `/api/donations/campaign/:id`  | No   | Campaign donor list    |
| POST   | `/api/donations/callback`      | No   | AzamPay webhook        |

---

## Deployment (Ubuntu/Nginx)

### 1. Install Node.js 18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Clone & install
```bash
git clone https://github.com/yourname/msaadafund.git
cd msaadafund && npm install --production
```

### 3. Set up systemd service
```ini
# /etc/systemd/system/msaadafund.service
[Unit]
Description=MsaadaFund
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/msaadafund
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable msaadafund && sudo systemctl start msaadafund
```

### 4. Nginx reverse proxy
```nginx
server {
    server_name msaadafund.co.tz www.msaadafund.co.tz;
    location / { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
    location /uploads/ { alias /var/www/msaadafund/uploads/; expires 30d; }
}
```
```bash
sudo certbot --nginx -d msaadafund.co.tz  # Free SSL
```

### 5. PostgreSQL (production upgrade)
Replace `better-sqlite3` with `pg` and update `db/database.js` to use `pg.Pool`.

---

## Project Structure

```
msaadafund/
├── server.js              # Express entry point
├── .env.example           # Environment template
├── db/
│   └── database.js        # SQLite setup + schema
├── routes/
│   ├── auth.js            # Phone OTP authentication
│   ├── campaigns.js       # Campaign CRUD + image upload
│   └── donations.js       # Payments + AzamPay callbacks
├── services/
│   ├── payments.js        # AzamPay integration
│   └── sms.js             # Africa's Talking SMS
├── middleware/
│   └── auth.js            # JWT middleware
├── public/
│   └── index.html         # SPA frontend
└── uploads/               # Campaign images
```

---

## Security Checklist (Before Launch)

- [ ] Generate strong `JWT_SECRET` (64+ random bytes)
- [ ] Set `NODE_ENV=production`
- [ ] Configure real AzamPay production credentials
- [ ] Configure real Africa's Talking account
- [ ] Set up HTTPS with valid certificate
- [ ] Configure proper CORS `FRONTEND_URL`
- [ ] Set up database backups
- [ ] Review campaign approval workflow
- [ ] Set `ADMIN_PHONE` for notifications

---

## License

MIT — Huru kutumia na kubadilisha kwa mahitaji yako.

---

**Maswali?** Wasiliana nasi: msaada@msaadafund.co.tz | +255 800 000 000
