const { getConfig } = require('./_lib/config');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const config = await getConfig();

    const dodoRes = await fetch(`${config.baseUrl}/products/${config.productId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!dodoRes.ok) {
      const errText = await dodoRes.text();
      console.error('[ProductInfo] Dodo error:', dodoRes.status, errText);
      return res.status(200).json({ error: 'Failed to fetch product info' });
    }

    const data = await dodoRes.json();

    // 返回官网需要的信息
    return res.status(200).json({
      name: data.name || 'StyleSnap Pro',
      price: data.price || data.amount || 2900, // 价格单位：分
      currency: data.currency || 'USD',
      formatted_price: formatPrice(data.price || data.amount || 2900, data.currency || 'USD'),
      description: data.description || '',
      active: data.active !== false,
    });

  } catch (err) {
    console.error('[ProductInfo] Error:', err.message);
    return res.status(200).json({ error: 'Service unavailable' });
  }
}

function formatPrice(amount, currency = 'USD') {
  if (!amount) return '$29';
  const dollars = amount / 100;
  return `$${Math.round(dollars)}`;
}
