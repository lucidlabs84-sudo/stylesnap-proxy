// Vercel Serverless Function — Dodo Payments Webhook for StyleSnap
// POST /api/webhook
// Receives payment events from Dodo Payments.
//
// For one-time payments, we care about:
// - payment.succeeded → user paid $29
// - payment.failed → payment failed
// - license_key.created / license_key.updated → license key events
//
// Security: Verifies webhook signature using HMAC-SHA256

const crypto = require('crypto');

const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET || '';

/**
 * Verify DodoPayments webhook signature.
 * DodoPayments sends a signature in the `webhook-signature` header.
 * The signature is computed as HMAC-SHA256(webhook_secret, raw_body).
 */
function verifySignature(rawBody, signatureHeader) {
  if (!DODO_WEBHOOK_SECRET) {
    console.warn('[Webhook] ⚠️ No webhook secret configured — skipping verification');
    return true; // Allow in dev mode
  }

  if (!signatureHeader) {
    console.error('[Webhook] ❌ No signature header provided');
    return false;
  }

  const expectedSig = crypto
    .createHmac('sha256', DODO_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // DodoPayments may send multiple signatures separated by spaces
  const signatures = signatureHeader.split(' ');
  for (const sig of signatures) {
    // Some implementations use t=timestamp,v1=signature format
    const sigPart = sig.includes(',') ? sig.split(',').pop().split('=')[1] : sig;
    if (crypto.timingSafeEqual(
      Buffer.from(sigPart, 'hex'),
      Buffer.from(expectedSig, 'hex')
    )) {
      return true;
    }
  }

  console.error('[Webhook] ❌ Signature verification failed');
  return false;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, webhook-signature');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get raw body for signature verification
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Verify webhook signature
    const signatureHeader = req.headers['webhook-signature'] || req.headers['x-webhook-signature'] || '';
    if (!verifySignature(rawBody, signatureHeader)) {
      console.error('[Webhook] ❌ Invalid signature — possible forged request');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const eventType = body.type || body.event_type || '';
    const payload = body.data || body.payload || body;

    console.log('[Webhook] Event:', eventType, 'Payload keys:', Object.keys(payload));

    // ─── Payment events ─────────────────────────────────────
    if (eventType === 'payment.succeeded') {
      const email = payload.customer?.email || payload.billing_address?.email || '';
      const paymentId = payload.id || payload.payment_id || '';
      const licenseKey = payload.license_key || '';
      console.log(`[Webhook] ✅ Payment succeeded: ${email} (${paymentId}) license_key=${licenseKey ? licenseKey.substring(0, 8) + '...' : 'N/A'}`);
    }

    if (eventType === 'payment.failed') {
      const email = payload.customer?.email || '';
      const paymentId = payload.id || '';
      console.log(`[Webhook] ❌ Payment failed: ${email} (${paymentId})`);
    }

    // ─── License key events ─────────────────────────────────
    if (eventType === 'license_key.created') {
      const keyId = payload.id || '';
      const status = payload.status || '';
      const customerId = payload.customer_id || '';
      console.log(`[Webhook] 🔑 License key created: id=${keyId} status=${status} customer=${customerId}`);
    }

    if (eventType === 'license_key.updated') {
      const keyId = payload.id || '';
      const status = payload.status || '';
      const instances = payload.instances_count ?? '?';
      console.log(`[Webhook] 🔑 License key updated: id=${keyId} status=${status} instances=${instances}`);
    }

    // Always return 200 quickly to acknowledge receipt
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    // Still return 200 to prevent retries
    return res.status(200).json({ received: true });
  }
}
