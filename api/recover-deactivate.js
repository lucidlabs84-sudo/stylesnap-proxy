// Vercel Serverless Function — Force-release all activations for a license
// POST /api/recover-deactivate
// Body: { license_key: string, email: string }
// Returns: { deactivated: boolean, released?: number, error? }
//
// Purpose: a self-service escape hatch. The normal /api/deactivate needs the
// instance_id, which only lives in the device's local storage. If that record
// is lost (reinstall, cleared data, a bug, a dead device) the user can hit
// "activation limit reached" with no way to free a slot. This verifies the
// caller owns the key (email must match the license's customer) and then
// deactivates every instance on the key, freeing all slots.
//
// Security: ownership proven by email match; Rate Limit 3 requests/10min per email.

const { getConfig } = require('./_lib/config');
const { Redis } = require('@upstash/redis');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const RATE_LIMIT_WINDOW = 10 * 60; // 10 minutes
const RATE_LIMIT_MAX     = 3;

async function checkRateLimit(email) {
  const redis = getRedis();
  if (!redis) { console.warn('[RecoverDeactivate] ⚠️ Redis not configured — skipping rate limit'); return true; }
  const key = `ratelimit:recover-deactivate:${email.toLowerCase().trim()}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, RATE_LIMIT_WINDOW);
  return current <= RATE_LIMIT_MAX;
}

// Find the DodoPayments customer id for an email (paged scan).
async function findCustomerId(email, config) {
  const target = email.toLowerCase().trim();
  const headers = { 'Authorization': `Bearer ${config.apiKey}` };
  const pageSize = 100, maxPages = 50;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ page_size: String(pageSize), page_number: String(page) });
    const res = await fetch(`${config.baseUrl}/customers?${params}`, { headers });
    if (!res.ok) { console.error('[RecoverDeactivate] customers error', res.status); return null; }
    const data = await res.json();
    const items = data.items || data.data || data || [];
    for (const c of items) {
      if ((c.email || '').toLowerCase().trim() === target) return c.customer_id || c.id || null;
    }
    const total = data.total_count || data.total || items.length;
    if (items.length < pageSize || (page + 1) * pageSize >= total) break;
  }
  return null;
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
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const licenseKey = ((body || {}).license_key || '').trim();
    const email      = ((body || {}).email || '').trim();

    if (!licenseKey || !email) {
      return res.status(200).json({ deactivated: false, error: 'License key and email are required.' });
    }

    if (!await checkRateLimit(email)) {
      return res.status(429).json({ deactivated: false, error: 'Too many requests. Please try again later.' });
    }

    const config  = await getConfig();
    const headers = { 'Authorization': `Bearer ${config.apiKey}` };

    // 1. Resolve customer by email, then confirm the key belongs to that customer.
    const customerId = await findCustomerId(email, config);
    if (!customerId) {
      return res.status(200).json({ deactivated: false, error: 'No purchase found for that email.' });
    }

    const licParams = new URLSearchParams({ customer_id: customerId });
    if (config.productId) licParams.set('product_id', config.productId);
    const licRes = await fetch(`${config.baseUrl}/license_keys?${licParams}`, { headers });
    const licData = await licRes.json();
    const licItems = licData.items || licData.data || licData || [];
    const match = licItems.find(k => ((k.key || k.license_key || '').trim() === licenseKey));
    if (!match) {
      return res.status(200).json({ deactivated: false, error: 'That license key does not belong to this email.' });
    }
    const licenseKeyId = match.id || match.license_key_id;

    // 2. List every instance on the key.
    const instParams = new URLSearchParams({ license_key_id: licenseKeyId, page_size: '100' });
    const instRes = await fetch(`${config.baseUrl}/license_key_instances?${instParams}`, { headers });
    const instData = await instRes.json();
    const instances = instData.items || instData.data || instData || [];

    // 3. Deactivate each instance.
    let released = 0;
    for (const inst of instances) {
      const instanceId = inst.id || inst.instance_id;
      if (!instanceId) continue;
      const d = await fetch(`${config.baseUrl}/licenses/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ license_key: licenseKey, license_key_instance_id: instanceId }),
      });
      if (d.ok) released++;
      else console.error('[RecoverDeactivate] deactivate failed', instanceId, d.status);
    }

    console.log(`[RecoverDeactivate] ${licenseKey.slice(0, 8)}… released ${released}/${instances.length} for ${email}`);
    return res.status(200).json({ deactivated: true, released });

  } catch (err) {
    console.error('[RecoverDeactivate] Error:', err.message);
    return res.status(200).json({ deactivated: false, error: 'Service unavailable. Please try again.' });
  }
}
