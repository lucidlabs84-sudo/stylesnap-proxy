// Vercel Serverless Function — License Key Recovery
// POST /api/recover
// Body: { email: string }
// Returns: { sent: boolean, message: string }
//
// Security: Validates x-extension-id header, CORS restricted to extension origin,
//           Rate Limit: 3 requests/10 minutes per email (Upstash Redis)

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

const EXTENSION_ID = 'hcoekdefjdnjbjhdhemgjagchcgkggb';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'StyleSnap <noreply@lucidlibs.dev>';
const RECOVERY_URL = process.env.RECOVERY_URL || 'https://style.lucidlibs.dev/recover';

// ── Upstash Redis Rate Limiter ───────────────
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const RATE_LIMIT_WINDOW = 10 * 60   // 10 minutes
const RATE_LIMIT_MAX = 3              // 3 requests per window

async function checkRateLimit(email) {
  const redis = getRedis();
  if (!redis) {
    console.warn('[Recover] ⚠️ Redis not configured — skipping rate limit');
    return true; // Allow when Redis is not configured
  }
  const key = `ratelimit:recover:${email.toLowerCase().trim()}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW);
  }
  return current <= RATE_LIMIT_MAX;
}

async function findLicenseKeyByEmail(email, config) {
  const targetEmail = email.toLowerCase().trim();
  const headers = { 'Authorization': `Bearer ${config.apiKey}` };

  // Step 1: Find customer by email
  let customerId = null;
  let customerName = '';
  let customerPage = 0;
  const pageSize = 100;
  const maxPages = 50;

  while (customerPage < maxPages && !customerId) {
    const params = new URLSearchParams();
    params.set('page_size', pageSize.toString());
    params.set('page_number', customerPage.toString());

    const custRes = await fetch(
      `${config.baseUrl}/customers?${params.toString()}`,
      { headers }
    );

    if (!custRes.ok) {
      console.error('[Recover] Dodo customers API error:', custRes.status, await custRes.text());
      return null;
    }

    const custData = await custRes.json();
    const custItems = custData.items || custData.data || custData || [];

    for (const c of custItems) {
      const cEmail = (c.email || '').toLowerCase().trim();
      if (cEmail === targetEmail) {
        customerId = c.customer_id || c.id || '';
        customerName = c.name || '';
        break;
      }
    }

    const totalCustomers = custData.total_count || custData.total || custItems.length;
    if (custItems.length < pageSize || (customerPage + 1) * pageSize >= totalCustomers) {
      break;
    }
    customerPage++;
  }

  if (!customerId) {
    console.log(`[Recover] No customer found for email: ${targetEmail}`);
    return null;
  }

  console.log(`[Recover] Found customer: ${customerId} (${customerName})`);

  // Step 2: Get license keys for this customer
  const licParams = new URLSearchParams();
  licParams.set('product_id', config.productId);
  licParams.set('customer_id', customerId);

  const licRes = await fetch(
    `${config.baseUrl}/license_keys?${licParams.toString()}`,
    { headers }
  );

  if (!licRes.ok) {
    console.error('[Recover] Dodo license_keys API error:', licRes.status, await licRes.text());
    return null;
  }

  const licData = await licRes.json();
  const licItems = licData.items || licData.data || licData || [];

  if (licItems.length === 0) {
    console.log(`[Recover] No license keys found for customer: ${customerId}`);
    return null;
  }

  const activeKey = licItems.find(k => k.status === 'active') || licItems[0];

  return {
    license_key: activeKey.key || activeKey.license_key || '',
    status: activeKey.status || '',
    activations_limit: activeKey.activations_limit || 2,
    activations_used: activeKey.instances_count ?? 0,
    created_at: activeKey.created_at || '',
    expires_at: activeKey.expires_at || null,
    customer_email: targetEmail,
    customer_name: customerName,
    product_name: 'StyleSnap Pro',
  };
}

async function sendRecoveryEmail(licenseInfo) {
  const { license_key, customer_email, customer_name, product_name, status, activations_limit, activations_used } = licenseInfo;

  const greeting = customer_name ? `Hi ${customer_name},` : 'Hello,';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 24px; font-weight: 700; margin: 0;">StyleSnap</h1>
    <p style="color: #666; font-size: 14px; margin: 4px 0 0;">License Key Recovery</p>
  </div>

  <p style="font-size: 15px; line-height: 1.6;">${greeting}</p>

  <p style="font-size: 15px; line-height: 1.6;">
    We received a request to recover your StyleSnap license key. Here it is:
  </p>

  <div style="background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
    <p style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px;">Your License Key</p>
    <p style="font-family: 'SF Mono', 'Fira Code', monospace; font-size: 16px; letter-spacing: 1.5px; color: #111; margin: 0; word-break: break-all;">${license_key}</p>
  </div>

  <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
      <tr><td style="color: #888; padding: 4px 0;">Product</td><td style="text-align: right; font-weight: 500;">${product_name}</td></tr>
      <tr><td style="color: #888; padding: 4px 0;">Status</td><td style="text-align: right; font-weight: 500; color: ${status === 'active' ? '#16a34a' : '#d97706'};">${status}</td></tr>
      <tr><td style="color: #888; padding: 4px 0;">Devices</td><td style="text-align: right; font-weight: 500;">${activations_used} / ${activations_limit}</td></tr>
    </table>
  </div>

  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; margin: 24px 0;">
    <p style="font-size: 13px; color: #1e40af; margin: 0;">
      <strong>How to activate:</strong> Open StyleSnap extension → Settings → Enter the license key above → Click Activate.
    </p>
  </div>

  <p style="font-size: 13px; color: #888; line-height: 1.5; margin-top: 24px;">
    If you didn't request this recovery, you can safely ignore this email. Your license key remains secure.
  </p>

  <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">

  <p style="font-size: 12px; color: #aaa; text-align: center;">
    StyleSnap by LucidLibs · <a href="https://style.lucidlibs.dev" style="color: #888;">style.lucidlibs.dev</a>
  </p>

</body>
</html>`;

  const textBody = `${greeting}

Your StyleSnap license key: ${license_key}

Product: ${product_name}
Status: ${status}
Devices: ${activations_used}/${activations_limit}

How to activate: Open StyleSnap → Settings → Enter license key → Activate.

If you didn't request this, ignore this email.

- StyleSnap by LucidLibs
https://style.lucidlibs.dev`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: customer_email,
      subject: 'Your StyleSnap License Key',
      html: htmlBody,
      text: textBody,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[Recover] Resend error:', res.status, errText);
    throw new Error('Failed to send email');
  }

  const result = await res.json();
  console.log(`[Recover] Email sent to ${customer_email}, id=${result.id}`);
  return true;
}

export default async function handler(req, res) {
  // ── CORS: only allow extension origin ─────────────
  const origin  = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const isFromExtension = origin.includes(EXTENSION_ID) || referer.includes(EXTENSION_ID);

  res.setHeader('Access-Control-Allow-Origin', isFromExtension ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-extension-id');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Validate extension header ─────────────
  const extId = req.headers['x-extension-id'] || '';
  if (extId !== EXTENSION_ID) {
    console.warn('[Recover] ❌ Invalid extension ID:', extId);
    return res.status(403).json({ error: 'Forbidden: invalid origin' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const config = await getConfig();
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const email = ((body || {}).email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return res.status(200).json({ sent: false, message: 'Please enter a valid email address.' });
    }

    if (!await checkRateLimit(email)) {
      return res.status(200).json({
        sent: false,
        message: 'Too many requests. Please wait 10 minutes before trying again.',
        rate_limited: true,
      });
    }

    console.log(`[Recover] Searching for email: ${email}`);
    const licenseInfo = await findLicenseKeyByEmail(email, config);

    if (!licenseInfo) {
      console.log(`[Recover] No license found for: ${email}`);
      return res.status(200).json({
        sent: false,
        message: 'If a license key exists for this email, a recovery email has been sent. Please check your inbox (and spam folder).',
        not_found: true,
      });
    }

    if (licenseInfo.status === 'disabled') {
      return res.status(200).json({
        sent: false,
        message: 'Your license has been disabled. Please contact support at lucidlibs@outlook.com.',
      });
    }

    if (!RESEND_API_KEY) {
      console.error('[Recover] RESEND_API_KEY not configured');
      return res.status(200).json({
        sent: false,
        message: 'Recovery service is temporarily unavailable. Please email lucidlibs@outlook.com.',
      });
    }

    await sendRecoveryEmail(licenseInfo);

    return res.status(200).json({
      sent: true,
      message: `License key has been sent to ${email}. Please check your inbox.`,
    });

  } catch (err) {
    console.error('[Recover] Error:', err.message);
    return res.status(200).json({
      sent: false,
      message: 'Recovery service is temporarily unavailable. Please try again later.',
    });
  }
}
