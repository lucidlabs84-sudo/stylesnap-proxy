// Vercel Serverless Function — Create Dodo Payments Checkout for StyleSnap Pro
// POST /api/checkout
// Body: { email?: string, return_url?: string }
// Returns: { checkout_url: string, session_id: string }
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

export default async function handler(req, res) {
  // ─── CORS: only allow extension origin ─────────────
  const origin = req.headers.origin || ''
  const referer = req.headers.referer || ''
  const isFromExtension = origin.includes(EXTENSION_ID) || referer.includes(EXTENSION_ID)

  res.setHeader('Access-Control-Allow-Origin', isFromExtension ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-extension-id')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ─── Validate extension header ─────────────────────
  const extId = req.headers['x-extension-id'] || ''
  if (extId !== EXTENSION_ID) {
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

    const checkoutBody = {
      product_cart: [{ product_id: config.productId, quantity: 1 }],
      return_url:  returnUrl,
      cancel_url:  cancelUrl,
      allowed_payment_method_types: [
        'credit', 'debit', 'apple_pay', 'google_pay', 'paypal',
        'ali_pay', 'we_chat_pay'
      ],
      billing_currency: 'USD',
      metadata: { source: 'chrome_extension' },
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
