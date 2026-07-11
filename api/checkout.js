// Vercel Serverless Function — Create Dodo Payments Checkout for StyleSnap Pro
// POST /api/checkout
// Body: { email?: string, return_url?: string }
// Returns: { checkout_url: string, session_id: string } | { duplicate: true, message: string }
//
// Security: Validates x-extension-id header, CORS restricted to extension origin,
//           Rate Limit: 10 requests/minute per IP (Upstash Redis)

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

const EXTENSION_ID = 'hcoekdefjdnjbjhdhemgjagchcgkggb'

// ─── Upstash Redis Rate Limiter ─────────────────
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || ''
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ''

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
}

const RATE_LIMIT_WINDOW = 60        // 1 minute
const RATE_LIMIT_MAX    = 10       // 10 requests per window

async function checkRateLimit(ip) {
  const redis = getRedis()
  if (!redis) {
    console.warn('[Checkout] ⚠️ Redis not configured — skipping rate limit')
    return true // Allow when Redis is not configured
  }
  const key = `ratelimit:checkout:${ip}`
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW)
  }
  return current <= RATE_LIMIT_MAX
}

/**
 * Check if a customer already owns an active license for this product.
 * Returns { duplicate: true, message: string } if duplicate found, null if clean.
 */
async function checkDuplicateEmail(email, config) {
  if (!email || !email.includes('@')) return null;
  const targetEmail = email.toLowerCase().trim();
  const headers = { 'Authorization': `Bearer ${config.apiKey}` };

  // Step 1: Find customer by email
  let customerId = null;
  const custRes = await fetch(
    `${config.baseUrl}/customers?email=${encodeURIComponent(targetEmail)}&page_size=5`,
    { headers }
  );

  if (!custRes.ok) return null;

  const custData = await custRes.json();
  const customers = custData.items || [];

  for (const c of customers) {
    const cEmail = (c.email || '').toLowerCase().trim();
    if (cEmail === targetEmail) {
      customerId = c.customer_id || c.id || '';
      break;
    }
  }

  if (!customerId) return null;

  // Step 2: Check for active license keys for this product
  const licParams = new URLSearchParams();
  licParams.set('product_id', config.productId);
  licParams.set('customer_id', customerId);

  const licRes = await fetch(
    `${config.baseUrl}/license_keys?${licParams.toString()}`,
    { headers }
  );

  if (!licRes.ok) return null;

  const licData = await licRes.json();
  const licItems = licData.items || [];

  for (const key of licItems) {
    if (key.status === 'active') {
      return {
        duplicate: true,
        message: 'You already own a StyleSnap Pro license. Check your email or recover it from the Recovery page.',
      };
    }
  }

  return null;
}

export default async function handler(req, res) {
  // ─── CORS: allow extension origin + website domains ─────────────
  const origin = req.headers.origin || ''
  const referer = req.headers.referer || ''
  const ALLOWED_ORIGINS = [
    EXTENSION_ID,                   // chrome-extension://...
    'lucidlibs.dev',                // main website
    'stylesnap.vercel.app',         // Vercel deploy
    'localhost',                    // local dev
  ]
  const isAllowed = ALLOWED_ORIGINS.some(allowed =>
    origin.includes(allowed) || referer.includes(allowed)
  )

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-extension-id')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Max-Age', '86400')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ─── Validate extension header (skip for website origins) ─────
  const isWebsiteOrigin = origin.includes('lucidlibs.dev') ||
                          origin.includes('stylesnap.vercel.app') ||
                          origin.includes('localhost')
  const isExtensionOrigin = origin.startsWith('chrome-extension://') ||
                            referer.startsWith('chrome-extension://')
  const extId = req.headers['x-extension-id'] || ''
  // Allow website origins (public checkout), any extension origin, or matching extension ID
  if (!isWebsiteOrigin && !isExtensionOrigin && extId !== EXTENSION_ID) {
    console.warn('[Checkout] ❌ Invalid extension ID:', extId)
    return res.status(403).json({ error: 'Forbidden: invalid origin' })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ─── Rate Limit ────────────────────────────────────
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  try {
    const config = await getConfig()
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = {} }
    }

    const email    = (body || {}).email || ''
    const returnUrl = (body || {}).return_url || 'https://lucidlibs.dev/stylesnap/success'
    const cancelUrl = (body || {}).cancel_url || 'https://lucidlibs.dev/stylesnap'

    // ─── Email validation (required for website checkouts) ────
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (isWebsiteOrigin && (!email || !EMAIL_RE.test(email))) {
      return res.status(200).json({ error: 'A valid email address is required for checkout.' });
    }

    // Check for duplicate purchase BEFORE creating checkout
    if (email) {
      const duplicate = await checkDuplicateEmail(email, config);
      if (duplicate) {
        console.log(`[Checkout] Duplicate purchase blocked: ${email}`);
        return res.status(200).json(duplicate);
      }
    }

    const checkoutBody = {
      product_cart: [{ product_id: config.productId, quantity: 1 }],
      return_url:  returnUrl,
      cancel_url:  cancelUrl,
      allowed_payment_method_types: [
        'credit', 'debit', 'apple_pay', 'google_pay', 'paypal',
        'ali_pay', 'we_chat_pay'
      ],
      billing_currency: 'USD',
      metadata: { source: isWebsiteOrigin ? 'website' : 'chrome_extension' },
    }

    if (email) checkoutBody.customer = { email }

    const dodoRes = await fetch(`${config.baseUrl}/checkouts`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(checkoutBody),
    })

    if (!dodoRes.ok) {
      const errText = await dodoRes.text()
      console.error('[Checkout] Dodo error:', dodoRes.status, errText)
      return res.status(200).json({ error: 'Failed to create checkout session' })
    }

    const data = await dodoRes.json()

    return res.status(200).json({
      checkout_url: data.checkout_url,
      session_id:   data.session_id,
    })

  } catch (err) {
    console.error('[Checkout] Error:', err.message)
    return res.status(200).json({ error: 'Service unavailable' })
  }
}
