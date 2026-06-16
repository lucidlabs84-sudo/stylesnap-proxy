// Vercel Serverless Function — Verify StyleSnap Pro License (backward compat)
// POST /api/verify
// Body: { license_key?: string, email?: string }
// Returns: { valid: boolean, ... }

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
    const email = ((body || {}).email || '').trim().toLowerCase();

    // --- New flow: License Key validation (public endpoint, no API key) ---
    if (licenseKey) {
      const validateRes = await fetch(`${config.baseUrl}/licenses/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey }),
      });

      const data = await validateRes.json();

      if (!validateRes.ok) {
        return res.status(200).json({
          valid: false,
          error: data.error || data.message || 'Validation failed.',
        });
      }

      return res.status(200).json({
        valid: data.valid === true,
        status: data.status,
        activations_used: data.activations_used,
        activations_limit: data.activations_limit,
        expires_at: data.expires_at || null,
      });
    }

    // --- Legacy flow: Email-based verification ---
    if (!email) {
      return res.status(200).json({ valid: false, error: 'License key or email is required.' });
    }

    const customerRes = await fetch(
      `${config.baseUrl}/customers?email=${encodeURIComponent(email)}&page_size=5`,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!customerRes.ok) {
      return res.status(200).json({ valid: false, error: 'Failed to verify purchase.' });
    }

    const customerData = await customerRes.json();
    const customers = customerData.items || [];

    if (customers.length === 0) {
      return res.status(200).json({ valid: false, error: 'No purchase found for this email.' });
    }

    for (const customer of customers) {
      const paymentRes = await fetch(
        `${config.baseUrl}/payments?customer_id=${encodeURIComponent(customer.customer_id)}&status=succeeded&page_size=10`,
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!paymentRes.ok) continue;

      const paymentData = await paymentRes.json();
      const payments = paymentData.items || [];

      if (payments.length > 0) {
        const payment = payments[0];
        return res.status(200).json({
          valid: true,
          customer_id: customer.customer_id,
          payment_id: payment.payment_id,
        });
      }
    }

    return res.status(200).json({
      valid: false,
      error: 'No completed purchase found for this email.',
    });

  } catch (err) {
    console.error('[Verify] Error:', err.message);
    return res.status(200).json({ valid: false, error: 'Verification service unavailable.' });
  }
}
