// Vercel Serverless Function — Admin: List/Create License Keys
// GET  /api/admin/licenses — List all license keys for the product
// POST /api/admin/licenses — Create a license key manually (if RBAC allows)
// DELETE /api/admin/licenses?id=xxx — Delete a license key
// ⚠️ TEMP: Remove before production launch

const DODO_API_KEY = process.env.DODO_API_KEY || '';
const DODO_BASE_URL = process.env.DODO_ENV === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com';
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || 'pdt_0NgJpLrjYb5WyvHwo2Z5X';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- GET: List licenses ---
  if (req.method === 'GET') {
    try {
      const listRes = await fetch(
        `${DODO_BASE_URL}/licenses?product_id=${PRODUCT_ID}`,
        { headers: { 'Authorization': `Bearer ${DODO_API_KEY}` } }
      );
      const data = await listRes.json();
      if (!listRes.ok) {
        return res.status(200).json({ error: 'Failed to list licenses', status: listRes.status, detail: data });
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(200).json({ error: err.message });
    }
  }

  // --- POST: Create a license key ---
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const email = (body || {}).email || 'test@style.lucidlibs.dev';
      const createRes = await fetch(`${DODO_BASE_URL}/licenses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DODO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product_id: PRODUCT_ID,
          customer_email: email,
        }),
      });
      const data = await createRes.json();
      if (!createRes.ok) {
        return res.status(200).json({ error: 'Failed to create license', status: createRes.status, detail: data });
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(200).json({ error: err.message });
    }
  }

  // --- DELETE: Delete a license key ---
  if (req.method === 'DELETE') {
    try {
      const licenseId = (req.query || {}).id;
      if (!licenseId) return res.status(200).json({ error: 'License ID required (?id=xxx)' });
      const delRes = await fetch(`${DODO_BASE_URL}/licenses/${licenseId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${DODO_API_KEY}` },
      });
      const data = await delRes.json();
      if (!delRes.ok) {
        return res.status(200).json({ error: 'Failed to delete license', status: delRes.status, detail: data });
      }
      return res.status(200).json({ deleted: true, detail: data });
    } catch (err) {
      return res.status(200).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
