const AfricasTalking = require('africastalking');

let AT;

function getAT() {
  if (!AT) {
    AT = AfricasTalking({
      username: process.env.AT_USERNAME || 'sandbox',
      apiKey: process.env.AT_API_KEY || 'test',
    });
  }
  return AT;
}

async function sendSMS(phone, message) {
  // Normalize phone: ensure +255 format
  const to = phone.startsWith('+') ? phone : '+' + phone.replace(/^0/, '255');
  
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📱 [SMS SANDBOX] To: ${to}\n   Message: ${message}`);
    return { status: 'sandbox', to, message };
  }

  const sms = getAT().SMS;
  const result = await sms.send({
    to: [to],
    message,
    from: process.env.AT_SENDER_ID || 'MsaadaFund',
  });
  return result;
}

async function sendOTP(phone, otp) {
  const message = `MsaadaFund: Nambari yako ya uthibitisho ni ${otp}. Itafaa kwa dakika 10. Usishiriki na mtu yeyote.`;
  return sendSMS(phone, message);
}

async function sendDonationConfirmation(phone, campaignTitle, amount) {
  const fmt = new Intl.NumberFormat('sw-TZ', { style: 'currency', currency: 'TZS', maximumFractionDigits: 0 }).format(amount);
  const message = `MsaadaFund: Mchango wako wa ${fmt} kwa kampeni "${campaignTitle}" umepokewa. Asante sana! Mungu akubariki.`;
  return sendSMS(phone, message);
}

async function sendCampaignApproved(phone, campaignTitle) {
  const message = `MsaadaFund: Hongera! Kampeni yako "${campaignTitle}" imeidhinishwa na iko hai. Shiriki kiungo chako na marafiki sasa!`;
  return sendSMS(phone, message);
}

async function sendCampaignUpdate(phones, campaignTitle, updateTitle) {
  const message = `MsaadaFund: Kampeni "${campaignTitle}" ina habari mpya: "${updateTitle}". Angalia ukurasa wa kampeni kwa maelezo zaidi.`;
  return Promise.all(phones.map(p => sendSMS(p, message)));
}

module.exports = { sendSMS, sendOTP, sendDonationConfirmation, sendCampaignApproved, sendCampaignUpdate };
