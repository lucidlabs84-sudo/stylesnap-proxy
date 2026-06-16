// Vercel Serverless Function — Validate StyleSnap Pro License Key
// POST /api/validate
// Body: { license_key: string, instance_id?: string }
// Returns: { valid: boolean, status?, error? }

const { getConfig } = require('./_lib/config');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validateBody),
    });

    const data = await validateRes.json();

    if (!validateRes.ok) {
      console.error('[Validate] Dodo error:', validateRes.status, JSON.stringify(data));
      return res.status(200).json({
        valid: false,
        error: data.error || data.message || 'Validation failed.',
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
