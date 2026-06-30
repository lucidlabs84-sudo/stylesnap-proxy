// Vercel Serverless Function — AI Component Generator
// POST /api/generate-component
// Body: { prompt, element_tag, tailwind_classes, license_key?, instance_id? }
// Returns: { code: string }
//
// Free users: 1 generation per day (tracked via Redis)
// Pro users:  unlimited (validated via DodoPayments license API)
//
// Security: Rate Limit: 5 requests/minute per IP (Upstash Redis)
// Real security is DodoPayments license key validation.

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

// ── Upstash Redis ───────────────
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

// ── Rate Limit ───────────────
const RATE_LIMIT_WINDOW = 60;   // 1 minute
const RATE_LIMIT_MAX    = 5;    // 5 requests per window

async function checkRateLimit(ip) {
  const redis = getRedis();
  if (!redis) return true; // Allow when Redis is not configured
  const key = `ratelimit:gencomp:${ip}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, RATE_LIMIT_WINDOW);
  return current <= RATE_LIMIT_MAX;
}

// ── Daily Free Limit ───────────────
const FREE_DAILY_LIMIT = 1;

function getDateKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function checkDailyFreeLimit(identifier) {
  const redis = getRedis();
  if (!redis) return { allowed: true, count: 0 }; // Allow when Redis unavailable — degraded

  const dateKey = getDateKey();
  const redisKey = `daily:gencomp:${identifier}:${dateKey}`;

  const current = await redis.get(redisKey);
  const count = parseInt(current || '0', 10);

  if (count >= FREE_DAILY_LIMIT) {
    return { allowed: false, count, limit: FREE_DAILY_LIMIT };
  }

  // Increment and set TTL (24h from now, aligned to midnight UTC-ish)
  await redis.incr(redisKey);
  if (count === 0) {
    // Set expiry to end of UTC day + 1h buffer
    const now = new Date();
    const endOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) + 3600000;
    const ttl = Math.ceil((endOfDay - now.getTime()) / 1000);
    await redis.expire(redisKey, Math.max(ttl, 3600));
  }

  return { allowed: true, count: count + 1, limit: FREE_DAILY_LIMIT };
}

// ── Pro validation (cached per session) ───────────────
async function validateProLicense(licenseKey, instanceId, config) {
  if (!licenseKey) return false;

  const redis = getRedis();
  const cacheKey = `pro:cache:${licenseKey}:${instanceId || 'noinst'}`;

  // Check cache (10 min TTL)
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached === 'pro') return true;
    if (cached === 'free') return false;
  }

  try {
    const validateBody = { license_key: licenseKey };
    if (instanceId) validateBody.license_key_instance_id = instanceId;

    const validateRes = await fetch(`${config.baseUrl}/licenses/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(validateBody),
    });

    const data = await validateRes.json();
    const isPro = validateRes.ok && data.valid === true;

    // Cache result
    if (redis) {
      await redis.set(cacheKey, isPro ? 'pro' : 'free', { ex: 600 }); // 10 min
    }

    return isPro;
  } catch (err) {
    console.error('[GenComponent] License validation error:', err.message);
    return false;
  }
}

// ── Groq API Call ───────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL    = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function callGroq(prompt) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[GenComponent] Groq error:', resp.status, errText.substring(0, 200));
    throw new Error(`Groq API error: ${resp.status}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';

  // Extract code from markdown code block
  const codeMatch = content.match(/```(?:tsx?|jsx?)?\n?([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : content.trim();
}

// ── Handler ───────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Rate Limit ───────────────
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (!await checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  try {
    const config = await getConfig();
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const prompt          = (body?.prompt || '').trim();
    const licenseKey      = (body?.license_key || '').trim();
    const instanceId      = (body?.instance_id || '').trim();

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    // ── Check Pro status ───────────────
    const isPro = await validateProLicense(licenseKey, instanceId, config);

    // ── Daily limit check (Free users only) ───────────────
    if (!isPro) {
      // Use license_key as identifier if available, otherwise fallback to IP
      const dailyIdentifier = licenseKey || clientIp;
      const { allowed, count, limit } = await checkDailyFreeLimit(dailyIdentifier);

      if (!allowed) {
        console.log(`[GenComponent] ⚠️ Daily limit reached for ${dailyIdentifier}: ${count}/${limit}`);
        return res.status(429).json({
          error: 'Daily limit reached. Upgrade to Pro for unlimited generations.',
          code: 'daily_limit',
          used: count,
          limit,
        });
      }

      console.log(`[GenComponent] ✅ Free generation ${count}/${limit} for ${dailyIdentifier}`);
    } else {
      console.log(`[GenComponent] ✅ Pro user — unlimited generation`);
    }

    // ── Call Groq ───────────────
    if (!GROQ_API_KEY) {
      console.error('[GenComponent] ❌ GROQ_API_KEY not configured');
      return res.status(500).json({ error: 'AI service not configured.' });
    }

    const code = await callGroq(prompt);

    console.log(`[GenComponent] ✅ Generated ${code.length} chars`);

    return res.status(200).json({
      code,
      model: GROQ_MODEL,
      usage: isPro ? { type: 'pro', remaining: 'unlimited' } : undefined,
    });

  } catch (err) {
    console.error('[GenComponent] Error:', err.message);
    return res.status(200).json({ error: 'Generation failed — please try again later.' });
  }
}
