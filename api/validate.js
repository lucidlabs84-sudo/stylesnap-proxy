// Vercel Serverless Function — Validate StyleSnap Pro License Key
// POST /api/validate
// Body: { license_key: string, instance_id?: string }
// Returns: { valid: boolean, status?, error? }
//
// Security: Rate Limit: 20 requests/minute per IP (Upstash Redis)
// Real security is DodoPayments license key validation.

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
const RATE_LIMIT_MAX    = 20   // 20 requests per window

async function checkRateLimit(ip) {
  const redis = getRedis()
  if (!redis) {
    console.warn('[Validate] ⚠️ Redis not configured — skipping rate limit')
    return true
  }
  const key = `ratelimit:validate:${ip}`
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
    const instanceId = ((body || {}).instance_id || '').trim();

    if (!licenseKey) {
      return res.status(200).json({ valid: false, error: 'License key is required.' });
    }

    const validateBody = { license_key: licenseKey };
    if (instanceId) {
      validateBody.license_key_instance_id = instanceId;
    }

    const validateRes = await fetch(`${config.baseUrl}/licenses/validate`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body:    JSON.stringify(validateBody),
    });

    const data = await validateRes.json();

    if (!validateRes.ok) {
      console.error('[Validate] Dodo error:', validateRes.status, JSON.stringify(data));
      return res.status(200).json({
        valid:  false,
        error:  data.error || data.message || 'Validation failed.',
      });
    }

    return res.status(200).json({
      valid: data.valid === true,
    });

  } catch (err) {
    console.error('[Validate] Error:', err.message);
    return res.status(200).json({ valid: false, error: 'Validation service unavailable.' });
  }
}
