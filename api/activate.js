// Vercel Serverless Function — Activate StyleSnap Pro License Key
// POST /api/activate
// Body: { license_key: string, device_name: string }
// Returns: { activated: boolean, instance_id?, customer_email?, product_name?, error?, limit_reached? }

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
    const deviceName = ((body || {}).device_name || 'Unknown Device').trim();

    if (!licenseKey) {
      return res.status(200).json({ activated: false, error: 'License key is required.' });
    }

    const activateRes = await fetch(`${config.baseUrl}/licenses/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        name: deviceName,
      }),
    });

    const data = await activateRes.json();

    if (!activateRes.ok) {
      console.error('[Activate] Dodo error:', activateRes.status, JSON.stringify(data));

      let errMsg = data.error || data.message || 'Activation failed.';
      let limitReached = false;

      if (activateRes.status === 403) {
        errMsg = 'This license key is not active. It may have been disabled or expired.';
      } else if (activateRes.status === 404) {
        errMsg = 'License key not found. Please check and try again.';
      } else if (activateRes.status === 422) {
        errMsg = 'Activation limit reached. Deactivate another device first.';
        limitReached = true;
      }

      return res.status(200).json({
        activated: false,
        error: errMsg,
        limit_reached: limitReached,
      });
    }

    const customerEmail = data.customer?.email || '';
    const customerName = data.customer?.name || '';
    const productName = data.product?.name || '';
    const productId = data.product?.product_id || '';

    console.log(`[Activate] ✅ License activated: ${licenseKey.substring(0, 8)}... instance=${data.id} email=${customerEmail}`);

    return res.status(200).json({
      activated: true,
      instance_id: data.id,
      customer_email: customerEmail,
      customer_name: customerName,
      product_name: productName,
      product_id: productId,
      created_at: data.created_at || null,
    });

  } catch (err) {
    console.error('[Activate] Error:', err.message);
    return res.status(200).json({ activated: false, error: 'Activation service unavailable.' });
  }
}
