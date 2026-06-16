// Vercel Serverless Function — Return current DodoPayments environment
// GET /api/env
// Returns: { env: "test" | "live" }
//
// Now reads from Supabase dodo_config table (instant switching).

const { getConfig } = require('./_lib/config');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const config = await getConfig();

  return res.status(200).json({
    env: config.env,
  });
}
