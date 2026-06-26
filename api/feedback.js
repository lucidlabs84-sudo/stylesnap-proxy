// Vercel Serverless Function — Submit Feedback
// POST /api/feedback
// Body: { type, message, email?, rating?, metadata? }
// Returns: { ok: boolean, error? }
//
// Security: CORS open (public feedback endpoint),
//           Rate Limit: 5 requests/60s per IP (Upstash Redis)
//           Writes via service role key (server-side only, never exposed to client)

const { Redis } = require('@upstash/redis');

// ── Upstash Redis Rate Limiter ───────────────
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const RATE_LIMIT_WINDOW = 60  // seconds
const RATE_LIMIT_MAX    = 5   // requests per window

async function checkRateLimit(ip) {
  const redis = getRedis();
  if (!redis) {
    console.warn('[Feedback] ⚠️ Redis not configured — skipping rate limit');
    return true;
  }
  const key = `ratelimit:feedback:${ip}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW);
  }
  return current <= RATE_LIMIT_MAX;
}

const VALID_TYPES = ['bug', 'feature', 'general', 'praise'];
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body) {
  const { type, message, email, rating } = body || {};

  if (!VALID_TYPES.includes(type)) {
    return `type must be one of: ${VALID_TYPES.join(', ')}`;
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return 'message must be a non-empty string';
  }
  if (message.length > 2000) {
    return 'message must be 2000 characters or fewer';
  }

  if (email !== undefined && email !== null && email !== '') {
    if (!EMAIL_RE.test(email)) {
      return 'email is not valid';
    }
  }

  if (rating !== undefined && rating !== null) {
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return 'rating must be an integer between 1 and 5';
    }
  }

  return null; // valid
}

export default async function handler(req, res) {
  // ── CORS: open (public feedback endpoint) ───────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-extension-id');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Rate Limit ───────────────────────────────────────────
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  }

  // ── Parse & validate body ────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const validationError = validate(body);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  const { type, message, email, rating, metadata } = body;

  // ── Write to Supabase via service role key ───────────────
  const supabaseUrl   = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Feedback] ❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  try {
    const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        source:   'extension',
        type,
        message:  message.trim(),
        email:    email?.trim() || null,
        rating:   rating ?? null,
        metadata: metadata ?? null,
      }),
    });

    if (!supabaseRes.ok) {
      const text = await supabaseRes.text();
      console.error('[Feedback] Supabase error:', supabaseRes.status, text);
      return res.status(500).json({ ok: false, error: 'Failed to save feedback' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[Feedback] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Feedback service unavailable' });
  }
}
