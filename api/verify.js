// Vercel Serverless Function — Verify StyleSnap Pro License
// POST /api/verify
// Body: { license_key?: string, email?: string }
// Returns: { valid: boolean, ... }
//
// Security: Validates x-extension-id header, CORS restricted,
//           Rate Limit: 20 requests/minute per IP (Upstash Redis)

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

const EXTENSION_ID = 'hcoekdefjdnjbjhdhemgjagchcgkggb'

// ── Upstash Redis Rate Limiter ─────────────────
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || ''
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ''

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
}

const RATE_LIMIT_WINDOW = 60   // 1 minute
const RATE_LIMIT_MAX    = 20   // 20 requests per window

async function checkRateLimit(ip) {
  const redis = getRedis()
  if (!redis) {
    console.warn('[Verify] ⚠️ Redis not configured — skipping rate limit')
    return true // Allow when Redis is not configured
  }
  const key = `ratelimit:verify:${ip}`
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW)
  }
  return current <= RATE_LIMIT_MAX
}

export default async function handler(req, res) {
  // ── CORS: only allow extension origin ──────────
  const origin  = req.headers.origin || ''
  const referer = req.headers.referer || ''
  const isFromExtension = origin.includes(EXTENSION_ID) || referer.includes(EXTENSION_ID)

  res.setHeader('Access-Control-Allow-Origin', isFromExtension ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-extension-id')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── Validate extension header ──────────
  const extId = req.headers['x-extension-id'] || ''
  if (extId !== EXTENSION_ID) {
    console.warn('[Verify] ❌ Invalid extension ID:', extId)
    return res.status(403).json({ error: 'Forbidden: invalid origin' })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Rate Limit ───────────────────────────
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

    const licenseKey = ((body || {}).license_key || '').trim()
    const email     = ((body || {}).email || '').trim().toLowerCase()

    // --- License Key validation (preferred flow) ---
    if (licenseKey) {
      const validateRes = await fetch(`${config.baseUrl}/licenses/validate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ license_key: licenseKey }),
        })

      const data = await validateRes.json()

      if (!validateRes.ok) {
        return res.status(200).json({
          valid: false,
          error: data.error || data.message || 'Validation failed.',
        })
      }

      return res.status(200).json({
        valid:            data.valid === true,
        status:           data.status,
        activations_used: data.activations_used,
        activations_limit: data.activations_limit,
        expires_at:       data.expires_at || null,
        // Return the license key so the extension can store it
        license_key:      licenseKey,
      })
    }

    // --- Legacy flow: Email-based verification ---
    if (!email) {
      return res.status(200).json({ valid: false, error: 'License key or email is required.' })
    }

    const customerRes = await fetch(
      `${config.baseUrl}/customers?email=${encodeURIComponent(email)}&page_size=5`,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type':  'application/json',
        },
      }
    )

    if (!customerRes.ok) {
      return res.status(200).json({ valid: false, error: 'Failed to verify purchase.' })
    }

    const customerData = await customerRes.json()
    const customers    = customerData.items || []

    if (customers.length === 0) {
      return res.status(200).json({ valid: false, error: 'No purchase found for this email.' })
    }

    for (const customer of customers) {
      const paymentRes = await fetch(
        `${config.baseUrl}/payments?customer_id=${encodeURIComponent(customer.customer_id)}&status=succeeded&page_size=10`,
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type':  'application/json',
          },
        }
      )

      if (!paymentRes.ok) continue

      const paymentData = await paymentRes.json()
      const payments    = paymentData.items || []

      if (payments.length > 0) {
        const payment = payments[0]
        return res.status(200).json({
          valid:       true,
          customer_id: customer.customer_id,
          payment_id:  payment.payment_id,
        })
      }
    }

    return res.status(200).json({
      valid: false,
      error: 'No completed purchase found for this email.',
    })

  } catch (err) {
    console.error('[Verify] Error:', err.message)
    return res.status(200).json({ valid: false, error: 'Verification service unavailable.' })
  }
}
