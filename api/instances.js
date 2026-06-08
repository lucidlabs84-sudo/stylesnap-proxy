// Vercel Serverless Function — List License Key Instances
// GET /api/instances?license_key_id=xxx — List instances for a license key (requires API key)
//
// DodoPayments API: GET /license_key_instances?license_key_id=xxx
// Returns: { items: [{ id, name, created_at, ... }] }

const DODO_API_KEY = process.env.DODO_API_KEY || '';
const DODO_BASE_URL = process.env.DODO_ENV === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { license_key_id, page_size, page_number } = req.query || {};

    if (!license_key_id) {
      return res.status(200).json({ error: 'license_key_id is required' });
    }

    const params = new URLSearchParams();
    params.set('license_key_id', license_key_id);
    if (page_size) params.set('page_size', page_size);
    if (page_number) params.set('page_number', page_number);

    const listRes = await fetch(
      `${DODO_BASE_URL}/license_key_instances?${params.toString()}`,
      { headers: { 'Authorization': `Bearer ${DODO_API_KEY}` } }
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
