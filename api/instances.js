// Vercel Serverless Function — List License Key Instances
// GET /api/instances?license_key_id=xxx
//
// Security: Admin authentication required (Authorization header)

const { getConfig } = require('./_lib/config');

export default async function handler(req, res) {
  // ── Admin Authentication ───────────────────────
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!ADMIN_API_KEY || token !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Admin API key required.' });
  }

  // Restrict CORS to admin dashboard only
  const origin = req.headers.origin || '';
  const allowedOrigin = process.env.ADMIN_DASHBOARD_URL || 'https://lucidlibs.dev';
  res.setHeader('Access-Control-Allow-Origin', origin === allowedOrigin ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const config = await getConfig();
    const { license_key_id, page_size, page_number } = req.query || {};

    if (!license_key_id) {
      return res.status(200).json({ error: 'license_key_id is required' });
    }

    const params = new URLSearchParams();
    params.set('license_key_id', license_key_id);
    if (page_size) params.set('page_size', page_size);
    if (page_number) params.set('page_number', page_number);

    const listRes = await fetch(
      `${config.baseUrl}/license_key_instances?${params.toString()}`,
      { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
    );

    const data = await listRes.json();
    if (!listRes.ok) {
      return res.status(200).json({ error: 'Failed to list instances', status: listRes.status, detail: data });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[Instances] Error:', err.message);
    return res.status(200).json({ error: err.message });
  }
}
