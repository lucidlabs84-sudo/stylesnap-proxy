// Vercel Serverless Function — Return current DodoPayments environment
// GET /api/env
// Returns: { env: "test" | "live" }
//
// Used by admin panel to detect the current proxy environment on page load,
// so the toggle reflects the actual state instead of always defaulting to "test".

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    env: process.env.DODO_ENV === 'live' ? 'live' : 'test',
  });
}
