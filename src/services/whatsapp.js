const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com/v21.0';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function getClient() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Send a free-form text message (for dev/sandbox testing)
// NOTE: In production, use sendTemplateMessage with approved Meta message templates.
// Free-form messages only work within the 24-hour customer service window.
async function sendMessage(to, message) {
  const client = getClient();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.post(url, payload);
      console.log(`WhatsApp message sent to ${to}`);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const errorData = err.response?.data?.error;
      console.error(
        `WhatsApp send attempt ${attempt}/${MAX_RETRIES} failed:`,
        errorData?.message || err.message
      );

      if (attempt < MAX_RETRIES && (!status || status >= 500 || status === 429)) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }
}

// Send a template message (for production use with approved templates)
async function sendTemplateMessage(to, templateName, components = []) {
  const client = getClient();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components,
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.post(url, payload);
      console.log(`WhatsApp template message sent to ${to}`);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      console.error(
        `WhatsApp template send attempt ${attempt}/${MAX_RETRIES} failed:`,
        err.response?.data?.error?.message || err.message
      );

      if (attempt < MAX_RETRIES && (!status || status >= 500 || status === 429)) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }
}

module.exports = { sendMessage, sendTemplateMessage };
