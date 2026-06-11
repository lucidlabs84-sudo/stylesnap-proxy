// Vercel Serverless Function — Create Dodo Payments Checkout for StyleSnap Pro
// POST /api/checkout
// Body: { email?: string, return_url?: string }
// Returns: { checkout_url: string, session_id: string }
//
// After payment, DodoPayments redirects to return_url with ?license_key=xxx&email=xxx

const DODO_API_KEY = process.env.DODO_API_KEY || '';
const DODO_BASE_URL = process.env.DODO_ENV === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com';
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || 'pdt_0NgJpLrjYb5WyvHwo2Z5X';

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

    const email = (body || {}).email || '';
    // Allow dynamic return_url (extension passes chrome.runtime.getURL)
    const returnUrl = (body || {}).return_url || 'https://lucidlibs.dev/stylesnap/success';
    const cancelUrl = (body || {}).cancel_url || 'https://lucidlibs.dev/stylesnap';

    const checkoutBody = {
      product_cart: [{ product_id: PRODUCT_ID, quantity: 1 }],
      // return_url will receive ?license_key=xxx&email=xxx after payment
      return_url: returnUrl,
      cancel_url: cancelUrl,
      allowed_payment_method_types: [
        'credit', 'debit', 'apple_pay', 'google_pay', 'paypal',
        'ali_pay', 'we_chat_pay'
      ],
      billing_currency: 'USD',
      metadata: { source: 'chrome_extension' },
    };

    if (email) {
      checkoutBody.customer = { email };
    }

    const dodoRes = await fetch(`${DODO_BASE_URL}/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutBody),
    });

    if (!dodoRes.ok) {
      const errText = await dodoRes.text();
      console.error('[Checkout] Dodo error:', dodoRes.status, errText);
      return res.status(200).json({ error: 'Failed to create checkout session' });
    }

    const data = await dodoRes.json();

    return res.status(200).json({
      checkout_url: data.checkout_url,
      session_id: data.session_id,
    });

  } catch (err) {
    console.error('[Checkout] Error:', err.message);
    return res.status(200).json({ error: 'Service unavailable' });
  }
}
