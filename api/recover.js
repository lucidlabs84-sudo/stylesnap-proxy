// Vercel Serverless Function — License Key Recovery
// POST /api/recover
// Body: { email: string }
// Returns: { sent: boolean, message: string }
//
// Flow:
//   1. Accept email from user
//   2. Paginate DodoPayments GET /customers to find matching email → get customer_id
//   3. Use customer_id to query GET /license_keys?customer_id=xxx → get license key
//   4. If found, send the license key to that email via Resend
//   5. Rate limit: in-memory Map (resets on cold start, acceptable for low traffic)

const DODO_API_KEY = process.env.DODO_API_KEY || '';
const DODO_BASE_URL = process.env.DODO_ENV === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com';
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || 'pdt_0NgJpLrjYb5WyvHwo2Z5X';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'StyleSnap <noreply@lucidlibs.dev>';
const RECOVERY_URL = process.env.RECOVERY_URL || 'https://style.lucidlibs.dev/recover';

// Simple in-memory rate limiter (per email, 10 min cooldown)
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

function isRateLimited(email) {
  const key = email.toLowerCase().trim();
  const lastTime = rateLimitMap.get(key);
  if (lastTime && (Date.now() - lastTime) < RATE_LIMIT_MS) {
    return true;
  }
  rateLimitMap.set(key, Date.now());
  // Cleanup old entries every 100 requests
  if (rateLimitMap.size > 500) {
    const cutoff = Date.now() - RATE_LIMIT_MS;
    for (const [k, v] of rateLimitMap) {
      if (v < cutoff) rateLimitMap.delete(k);
    }
  }
  return false;
}

async function findLicenseKeyByEmail(email) {
  const targetEmail = email.toLowerCase().trim();
  const headers = { 'Authorization': `Bearer ${DODO_API_KEY}` };

  // Step 1: Find customer by email — paginate through all customers
  let customerId = null;
  let customerName = '';
  let customerPage = 0;
  const pageSize = 100;
  const maxPages = 50; // Safety limit

  while (customerPage < maxPages && !customerId) {
    const params = new URLSearchParams();
    params.set('page_size', pageSize.toString());
    params.set('page_number', customerPage.toString());

    const custRes = await fetch(
      `${DODO_BASE_URL}/customers?${params.toString()}`,
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
        customerId = c.id;
        customerName = c.name || '';
        break;
      }
    }

    // Check pagination
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
  licParams.set('product_id', PRODUCT_ID);
  licParams.set('customer_id', customerId);

  const licRes = await fetch(
    `${DODO_BASE_URL}/license_keys?${licParams.toString()}`,
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

  // Return the first active license key
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

  const maskedKey = license_key.length > 12
    ? license_key.substring(0, 8) + '•••••••' + license_key.slice(-4)
    : '•••••••';

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const email = ((body || {}).email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return res.status(200).json({ sent: false, message: 'Please enter a valid email address.' });
    }

    // Rate limit check
    if (isRateLimited(email)) {
      return res.status(200).json({
        sent: false,
        message: 'Too many requests. Please wait 10 minutes before trying again.',
        rate_limited: true,
      });
    }

    // Find license key by email
    console.log(`[Recover] Searching for email: ${email}`);
    const licenseInfo = await findLicenseKeyByEmail(email);

    if (!licenseInfo) {
      // Still return success-like response to prevent email enumeration
      // But give a hint that they should check their email
      console.log(`[Recover] No license found for: ${email}`);
      return res.status(200).json({
        sent: false,
        message: 'If a license key exists for this email, a recovery email has been sent. Please check your inbox (and spam folder).',
        not_found: true,
      });
    }

    // Check if license is disabled
    if (licenseInfo.status === 'disabled') {
      return res.status(200).json({
        sent: false,
        message: 'Your license has been disabled. Please contact support at lucidlibs@outlook.com.',
      });
    }

    // Send recovery email via Resend
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
