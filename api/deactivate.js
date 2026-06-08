// Vercel Serverless Function — Deactivate a StyleSnap Pro License Instance
// POST /api/deactivate
// Body: { license_key: string, instance_id: string }
// Returns: { deactivated: boolean, error? }
//
// Proxies to DodoPayments public /licenses/deactivate endpoint (no API key needed)
// DodoPayments request: { license_key, license_key_instance_id }
// DodoPayments response: 200 on success (empty body), 403/404/500 on error

const DODO_BASE_URL = process.env.DODO_ENV === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const licenseKey = ((body || {}).license_key || '').trim();
    const instanceId = ((body || {}).instance_id || '').trim();

    if (!licenseKey || !instanceId) {
      return res.status(200).json({ deactivated: false, error: 'License key and instance ID are required.' });
    }

    // DodoPayments public endpoint — no API key needed
    const deactivateRes = await fetch(`${DODO_BASE_URL}/licenses/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        license_key_instance_id: instanceId,
      }),
    });

    // DodoPayments deactivate returns 200 with empty body on success
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
