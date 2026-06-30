// Vercel Serverless Function — Activate StyleSnap Pro License Key
// POST /api/activate
// Body: { license_key: string, device_name: string }
// Returns: { activated: boolean, instance_id?, customer_email?, product_name?, error?, limit_reached? }
//
// Security: Rate Limit: 10 requests/minute per IP (Upstash Redis)
// Real security is DodoPayments license key validation — no extension-ID gate needed.

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

// ── Upstash Redis Rate Limiter ───────────────
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const RATE_LIMIT_WINDOW = 60   // 1 minute
const RATE_LIMIT_MAX    = 10   // 10 requests per window

async function checkRateLimit(ip) {
  const redis = getRedis()
  if (!redis) {
    console.warn('[Activate] ⚠️ Redis not configured — skipping rate limit')
    return true // Allow when Redis is not configured
  }
  const key = `ratelimit:activate:${ip}`
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW)
  }
  return current <= RATE_LIMIT_MAX
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Rate Limit ──────────────────────────
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  try {
    const config = await getConfig();
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const licenseKey = ((body || {}).license_key || '').trim();
    const deviceName = ((body || {}).device_name || 'Unknown Device').trim();

    if (!licenseKey) {
      return res.status(200).json({ activated: false, error: 'License key is required.' });
    }

    const activateRes = await fetch(`${config.baseUrl}/licenses/activate`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body:    JSON.stringify({
        license_key: licenseKey,
        name:       deviceName,
      }),
    });

    const data = await activateRes.json();

    if (!activateRes.ok) {
      console.error('[Activate] Dodo error:', activateRes.status, JSON.stringify(data));

      let errMsg       = data.error || data.message || 'Activation failed.';
      let limitReached = false;

      if (activateRes.status === 403) {
        errMsg = 'This license key is not active. It may have been disabled or expired.';
      } else if (activateRes.status === 404) {
        errMsg = 'License key not found. Please check and try again.';
      } else if (activateRes.status === 422) {
        errMsg       = 'Activation limit reached. Deactivate another device first.';
        limitReached = true;
      }

      return res.status(200).json({
        activated:    false,
        error:        errMsg,
        limit_reached: limitReached,
      });
    }

    const customerEmail = data.customer?.email || '';
    const customerName = data.customer?.name || '';
    const productName  = data.product?.name || '';
    const productId    = data.product?.product_id || '';

    console.log(`[Activate] ✅ License activated: ${licenseKey.substring(0, 8)}... instance=${data.id} email=${customerEmail}`);

    return res.status(200).json({
      activated:     true,
      instance_id:   data.id,
      customer_email: customerEmail,
      customer_name: customerName,
      product_name:   productName,
      product_id:     productId,
      created_at:     data.created_at || null,
    });

  } catch (err) {
    console.error('[Activate] Error:', err.message);
    return res.status(200).json({ activated: false, error: 'Activation service unavailable.' });
  }
}
