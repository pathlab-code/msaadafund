/**
 * AzamPay Payment Service
 * Tanzania's leading payment aggregator — supports M-Pesa, Tigo Pesa, Airtel Money
 * Docs: https://developerdocs.azampay.co.tz
 *
 * Sign up: https://developers.azampay.co.tz
 * Sandbox base URL: https://sandbox.azampay.co.tz
 * Production base URL: https://api.azampay.co.tz
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.AZAMPAY_BASE_URL || 'https://sandbox.azampay.co.tz';
let cachedToken = null;
let tokenExpiry = 0;

// MNO provider codes for AzamPay
const MNO_CODES = {
  mpesa:  'Mpesa',
  tigo:   'Tigo',
  airtel: 'Airtel',
  halopesa: 'Halopesa',
};

/**
 * Get or refresh AzamPay bearer token
 */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const res = await axios.post(
    `${BASE_URL}/AppRegistration/GenerateToken`,
    {
      appName:      process.env.AZAMPAY_APP_NAME    || 'MsaadaFund',
      clientId:     process.env.AZAMPAY_CLIENT_ID   || 'sandbox-client-id',
      clientSecret: process.env.AZAMPAY_CLIENT_SECRET || 'sandbox-client-secret',
    },
    { timeout: 10000 }
  );

  cachedToken = res.data.data?.accessToken;
  // Token typically valid for 3600 seconds
  tokenExpiry = Date.now() + ((res.data.data?.expire || 3600) * 1000);
  return cachedToken;
}

/**
 * Initiate a mobile money payment (STK push)
 * @param {object} params
 * @param {string} params.phone      - Customer phone e.g. "0754123456"
 * @param {number} params.amount     - Amount in TZS
 * @param {string} params.provider   - "mpesa" | "tigo" | "airtel"
 * @param {string} params.orderId    - Unique order reference
 * @param {string} params.callbackUrl
 * @returns {Promise<object>}
 */
async function initiateMobilePayment({ phone, amount, provider, orderId, callbackUrl }) {
  if (process.env.NODE_ENV !== 'production') {
    // Simulate success in sandbox/dev
    console.log(`💳 [AzamPay SANDBOX] Initiating ${provider} payment`);
    console.log(`   Phone: ${phone}, Amount: ${amount} TZS, Order: ${orderId}`);
    return {
      success: true,
      orderId,
      transactionId: 'SANDBOX-' + Date.now(),
      message: 'Ombi la malipo limetumwa (sandbox)',
    };
  }

  const token = await getToken();
  const mnoProv = MNO_CODES[provider.toLowerCase()];
  if (!mnoProv) throw new Error(`Provider isiyojulikana: ${provider}`);

  // Normalize phone number
  const normalizedPhone = phone.replace(/\s|-/g, '').replace(/^0/, '255').replace(/^\+/, '');

  const payload = {
    accountNumber: normalizedPhone,
    amount:        String(Math.round(amount)),
    currency:      'TZS',
    externalId:    orderId,
    provider:      mnoProv,
    additionalProperties: {
      orderId,
      callbackUrl: callbackUrl || process.env.APP_URL + '/api/payments/callback',
    },
  };

  const res = await axios.post(
    `${BASE_URL}/azampay/mno/checkout`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  if (!res.data.success) {
    throw new Error(res.data.message || 'Malipo yameshindwa kuanzishwa');
  }

  return {
    success: true,
    orderId,
    transactionId: res.data.transactionId,
    message: res.data.message,
  };
}

/**
 * Query payment status
 */
async function queryPaymentStatus(orderId) {
  if (process.env.NODE_ENV !== 'production') {
    return { status: 'COMPLETED', orderId };
  }

  const token = await getToken();
  const res = await axios.get(
    `${BASE_URL}/azampay/mno/checkout/status/${orderId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    }
  );
  return res.data;
}

/**
 * Handle payment callback from AzamPay
 * Returns normalized status: 'completed' | 'failed' | 'pending'
 */
function parseCallback(payload) {
  // AzamPay callback structure
  const status = payload?.transactionStatus?.toUpperCase();
  const normalized =
    status === 'COMPLETED' || status === 'SUCCESS'  ? 'completed' :
    status === 'FAILED'    || status === 'CANCELED'  ? 'failed'    : 'pending';

  return {
    status: normalized,
    transactionId:  payload?.transactionId,
    orderId:        payload?.externalId || payload?.orderId,
    amount:         parseFloat(payload?.amount || 0),
    phone:          payload?.msisdn || payload?.accountNumber,
    rawStatus:      status,
  };
}

module.exports = { initiateMobilePayment, queryPaymentStatus, parseCallback };
