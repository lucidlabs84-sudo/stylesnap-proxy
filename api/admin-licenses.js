// Vercel Serverless Function — Admin: List/Create License Keys
// GET  /api/admin/licenses — List all license keys for the product
// POST /api/admin/licenses — Create a license key manually
// PATCH /api/admin/licenses?id=xxx — Update a license key (status, activations_limit)
//
// Uses DodoPayments /license_keys endpoints (API key required)
// Note: DodoPayments has NO delete endpoint — use Revoke Grant from Entitlements instead

const DODO_API_KEY = process.env.DODO_API_KEY || '';
const DODO_BASE_URL = process.env.DODO_ENV === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com';
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || 'pdt_0NgJpLrjYb5WyvHwo2Z5X';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- GET: List license keys ---
  if (req.method === 'GET') {
    try {
      const { page_size, page_number, status, customer_id, source } = req.query || {};
      const params = new URLSearchParams();
      params.set('product_id', PRODUCT_ID);
      if (page_size) params.set('page_size', page_size);
      if (page_number) params.set('page_number', page_number);
      if (status) params.set('status', status);
      if (customer_id) params.set('customer_id', customer_id);
      if (source) params.set('source', source);

      const listRes = await fetch(
        `${DODO_BASE_URL}/license_keys?${params.toString()}`,
        { headers: { 'Authorization': `Bearer ${DODO_API_KEY}` } }
      );
      const data = await listRes.json();
      if (!listRes.ok) {
        return res.status(200).json({ error: 'Failed to list license keys', status: listRes.status, detail: data });
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
      const customerId = (body || {}).customer_id || '';
      const key = (body || {}).key || '';  // Optional: import existing key
      const activationsLimit = (body || {}).activations_limit ?? 2;

      if (!customerId) {
        return res.status(200).json({ error: 'customer_id is required' });
      }

      const createBody = {
        product_id: PRODUCT_ID,
        customer_id: customerId,
        activations_limit: activationsLimit,
      };
      // If key provided, import it
      if (key) createBody.key = key;

      const createRes = await fetch(`${DODO_BASE_URL}/license_keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DODO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createBody),
      });
      const data = await createRes.json();
      if (!createRes.ok) {
        return res.status(200).json({ error: 'Failed to create license key', status: createRes.status, detail: data });
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(200).json({ error: err.message });
    }
  }

  // --- PATCH: Update a license key ---
  if (req.method === 'PATCH') {
    try {
      const licenseId = (req.query || {}).id;
      if (!licenseId) return res.status(200).json({ error: 'License ID required (?id=xxx)' });

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const updateBody = {};
      if (body.status) updateBody.status = body.status;
      if (body.activations_limit !== undefined) updateBody.activations_limit = body.activations_limit;
      if (body.expires_at !== undefined) updateBody.expires_at = body.expires_at;

      const updateRes = await fetch(`${DODO_BASE_URL}/license_keys/${licenseId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${DODO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateBody),
      });
      const data = await updateRes.json();
      if (!updateRes.ok) {
        return res.status(200).json({ error: 'Failed to update license key', status: updateRes.status, detail: data });
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(200).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
