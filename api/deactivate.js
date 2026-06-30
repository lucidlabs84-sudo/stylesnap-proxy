// Vercel Serverless Function — Deactivate a StyleSnap Pro License Instance
// POST /api/deactivate
// Body: { license_key: string, instance_id: string }
// Returns: { deactivated: boolean, error? }
//
// Security: Rate Limit: 10 requests/minute per IP (Upstash Redis)
// Real security is DodoPayments license key validation.

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

// ─── Upstash Redis Rate Limiter ───────────────
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
    console.warn('[Deactivate] ⚠️ Redis not configured — skipping rate limit')
    return true
  }
  const key = `ratelimit:deactivate:${ip}`
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

  // ─── Rate Limit ──────────────────────────
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

    if (!licenseKey || !instanceId) {
      return res.status(200).json({ deactivated: false, error: 'License key and instance ID are required.' });
    }

    const deactivateRes = await fetch(`${config.baseUrl}/licenses/deactivate`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body:    JSON.stringify({
        license_key: licenseKey,
        license_key_instance_id: instanceId,
      }),
    });

    const text = await deactivateRes.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch { /* empty response is success */ }
    }

    if (!deactivateRes.ok) {
      console.error('[Deactivate] Dodo error:', deactivateRes.status, text);

      let errMsg = (data.error || data.message || '').toString();
      if (deactivateRes.status === 403) {
        errMsg = 'Instance not found or does not belong to this license key.';
      } else if (deactivateRes.status === 404) {
        errMsg = 'License key not found. It may have been revoked.';
      }

      return res.status(200).json({
        deactivated: false,
        error: errMsg || 'Deactivation failed.',
      });
    }

    console.log(`[Deactivate] ✅ Instance deactivated: ${instanceId}`);

    return res.status(200).json({ deactivated: true });

  } catch (err) {
    console.error('[Deactivate] Error:', err.message);
    return res.status(200).json({ deactivated: false, error: 'Deactivation service unavailable.' });
  }
}
