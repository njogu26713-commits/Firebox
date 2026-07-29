/**
 * Safaricom Daraja M-Pesa STK Push helper
 * Set MPESA_TEST_MODE=true to skip real API calls (dev/sandbox simulation)
 */
const axios = require('axios');
const crypto = require('crypto');

const SANDBOX_URL    = 'https://sandbox.safaricom.co.ke';
const PRODUCTION_URL = 'https://api.safaricom.co.ke';

function baseUrl() {
  return process.env.MPESA_ENV === 'production' ? PRODUCTION_URL : SANDBOX_URL;
}

function isTestMode() {
  return process.env.MPESA_TEST_MODE === 'true';
}

async function getAccessToken() {
  const key    = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('M-Pesa consumer key/secret not configured');

  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res  = await axios.get(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 15000,
  });
  return res.data.access_token;
}

/**
 * Normalise a Kenyan phone to 2547XXXXXXXX format.
 */
function normalisePhone(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0'))   p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!p.startsWith('254')) p = '254' + p;
  return p;
}

/**
 * Initiate an STK push.
 * Returns { CheckoutRequestID, MerchantRequestID } on success.
 */
async function stkPush({ phone, amount, accountRef, description, callbackUrl }) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey   = process.env.MPESA_PASSKEY;

  if (!shortcode || !passkey) throw new Error('M-Pesa shortcode/passkey not configured');

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const password  = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const token     = await getAccessToken();
  const msisdn    = normalisePhone(phone);

  const res = await axios.post(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: shortcode,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.ceil(amount),
    PartyA:            msisdn,
    PartyB:            shortcode,
    PhoneNumber:       msisdn,
    CallBackURL:       callbackUrl,
    AccountReference:  accountRef,
    TransactionDesc:   description,
  }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  if (res.data.ResponseCode !== '0') {
    throw new Error(res.data.ResponseDescription || 'STK push failed');
  }
  return {
    CheckoutRequestID: res.data.CheckoutRequestID,
    MerchantRequestID: res.data.MerchantRequestID,
  };
}

/**
 * Simulate an STK push in test mode — immediately returns a fake CheckoutRequestID.
 */
function stkPushTest({ phone, amount, accountRef }) {
  const fakeId = 'TEST-' + crypto.randomUUID().toUpperCase().replace(/-/g, '').slice(0, 20);
  console.log(`[MPESA TEST] Fake STK push for ${phone} KSh ${amount} (${accountRef}) → ${fakeId}`);
  return { CheckoutRequestID: fakeId, MerchantRequestID: 'MERCH-' + fakeId };
}

module.exports = {
  isTestMode,
  normalisePhone,
  stkPush: async (opts) => isTestMode() ? stkPushTest(opts) : stkPush(opts),
};
