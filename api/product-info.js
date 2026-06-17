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
      // 降级：返回默认价格
      return res.status(200).json({
        name: 'StyleSnap Pro',
        price: 2900,
        currency: 'USD',
        formatted_price: '$29',
        description: 'StyleSnap Pro - Lifetime License. Extract CSS styles and generate code with AI.',
        active: true,
      });
    }

    const data = await dodoRes.json();

    // 提取价格（单位：分）
    // DodoPayments 返回格式: { price: { price: number, currency: string } }
    const priceInCents = (data.price && typeof data.price.price === 'number')
      ? data.price.price
      : 2900; // 默认 $29

    const currency = (data.price && data.price.currency) || data.currency || 'USD';

    // 如果价格为 0，使用默认 $29
    const finalPriceInCents = priceInCents > 0 ? priceInCents : 2900;

    const formattedPrice = formatPrice(finalPriceInCents, currency);

    return res.status(200).json({
      name: data.name || 'StyleSnap Pro',
      price: finalPriceInCents,
      currency: currency,
      formatted_price: formattedPrice,
      description: data.description || '',
      active: data.active !== false,
    });

  } catch (err) {
    console.error('[ProductInfo] Error:', err.message);
    // 降级：返回默认价格
    return res.status(200).json({
      name: 'StyleSnap Pro',
      price: 2900,
      currency: 'USD',
      formatted_price: '$29',
      description: 'StyleSnap Pro - Lifetime License.',
      active: true,
    });
  }
}

function formatPrice(amountInCents, currency = 'USD') {
  if (!amountInCents || amountInCents <= 0) return '$29';
  const dollars = amountInCents / 100;
  return `$${Math.round(dollars)}`;
}
