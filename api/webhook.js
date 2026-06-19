// Vercel Serverless Function — Dodo Payments Webhook for StyleSnap
// POST /api/webhook
// Receives payment events from Dodo Payments.
//
// Events handled:
// - payment.succeeded → generate license key, save to Redis, send via Resend
// - payment.failed   → log
// - license_key.created / license_key.updated → log
//
// Security: Verifies webhook signature using HMAC-SHA256

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

const crypto = require('crypto');

const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET || '';
const RESEND_API_KEY     = process.env.RESEND_API_KEY || '';
const FROM_EMAIL         = process.env.FROM_EMAIL || 'StyleSnap <noreply@stylesnap.dev>';

// Upstash Redis for license persistence
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

function getRedis() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  return new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
if (!resend) console.warn('[Webhook] ⚠️ RESEND_API_KEY not set — emails will not be sent');

/**
 * Verify Dodo Payments webhook signature.
 * Header: webhook-signature = HMAC-SHA256(webhook_secret, raw_body)
 */
function verifySignature(rawBody, signatureHeader) {
  if (!DODO_WEBHOOK_SECRET) {
    console.warn('[Webhook] ⚠️ No webhook secret configured — skipping verification');
    return true; // Allow in dev mode
  }
  if (!signatureHeader) {
    console.error('[Webhook] ❌ No signature header');
    return false;
  }
  try {
    const expectedSig = crypto
      .createHmac('sha256', DODO_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    // Dodo may send multiple signatures; check each
    const signatures = signatureHeader.split(' ');
    for (const sig of signatures) {
      const sigPart = sig.includes(',') ? sig.split(',').pop().split('=')[1] : sig;
      if (sigPart && crypto.timingSafeEqual(
        Buffer.from(sigPart, 'hex'),
        Buffer.from(expectedSig, 'hex')
      )) return true;
    }
    console.error('[Webhook] ❌ Signature mismatch');
    return false;
  } catch (e) {
    console.error('[Webhook] ❌ Signature verification error:', e.message);
    return false;
  }
}

/**
 * Generate a human-friendly license key from payment ID
 */
function generateLicenseKey(paymentId) {
  const suffix  = paymentId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  const random  = Math.random().toString(36).substring(2, 8).toUpperCase();
  const time    = Date.now().toString(36).toUpperCase();
  return `SS-${suffix}-${time}-${random}`;
}

/**
 * Send license key email via Resend
 */
async function sendLicenseEmail(email, licenseKey, paymentId) {
  if (!resend) {
    console.warn('[Webhook] ⚠️ Resend not configured — skip email');
    return false;
  }
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Your StyleSnap Pro License Key',
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
              StyleSnap
            </div>
            <p style="color:#6366f1;font-weight:600;margin:4px 0 0;">Pro Activated 🎉</p>
          </div>

          <p style="font-size:15px;line-height:1.6;">Thank you for purchasing <strong>StyleSnap Pro</strong>! Your license key is below:</p>

          <div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
            <code style="font-size:16px;font-weight:700;color:#6366f1;letter-spacing:0.5px;">${licenseKey}</code>
          </div>

          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:16px 0;">
            <p style="font-weight:600;margin:0 0 8px;color:#374151;">How to activate:</p>
            <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.8;color:#4b5563;">
              <li>Open the StyleSnap extension in your browser</li>
              <li>Go to <strong>Settings</strong> → click <strong>Activate</strong></li>
              <li>Paste the license key above and click <strong>Activate</strong></li>
            </ol>
          </div>

          <p style="font-size:13px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">
            Payment ID: ${paymentId}<br/>
            Questions? Reply to this email or visit <a href="https://stylesnap.dev/support" style="color:#6366f1;">stylesnap.dev/support</a>
          </p>
        </div>
      `,
    });
    console.log(`[Webhook] ✅ Email sent to ${email}`, result?.id ? `message_id=${result.id}` : '');
    return true;
  } catch (e) {
    console.error('[Webhook] ❌ Failed to send email:', e.message);
    return false;
  }
}

export default async function handler(req, res) {
  // Webhook is server-to-server; no CORS needed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signatureHeader = req.headers['webhook-signature'] || req.headers['x-webhook-signature'] || '';

    if (!verifySignature(rawBody, signatureHeader)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = body.type || body.event_type || '';
    const payload   = body.data || body.payload || body;

    console.log('[Webhook] Event:', eventType);

    // ─── payment.succeeded ─────────────────────────────
    if (eventType === 'payment.succeeded') {
      const email     = payload.customer?.email || payload.billing_address?.email || '';
      const paymentId = payload.id || payload.payment_id || '';
      const amount    = payload.amount || 0;

      const licenseKey = generateLicenseKey(paymentId);

      console.log('[Webhook] ✅ Payment succeeded:');
      console.log('  email:     ', email);
      console.log('  payment_id:', paymentId);
      console.log('  amount:    ', amount);
      console.log('  license:   ', licenseKey);

      // Send email (fire-and-forget — don't block webhook response)
      if (email) {
        sendLicenseEmail(email, licenseKey, paymentId).catch(e =>
          console.error('[Webhook] Email error:', e.message)
        );
      } else {
        console.warn('[Webhook] ⚠️ No email — cannot send license key');
      }

      // Save to Upstash Redis
      const redis = getRedis();
      if (redis) {
        try {
          await redis.hset('licenses', licenseKey, JSON.stringify({
            email,
            paymentId,
            createdAt: new Date().toISOString(),
            status: 'active',
          }));
          // Also index by email for lookup
          await redis.sadd(`licenses:email:${email}`, licenseKey);
          console.log(`[Webhook] ✅ License saved to Redis: ${licenseKey}`);
        } catch (e) {
          console.error('[Webhook] ❌ Failed to save license to Redis:', e.message);
        }
      } else {
        console.warn('[Webhook] ⚠️ Redis not configured — license not persisted');
      }
    }

    // ─── payment.failed ────────────────────────────────
    if (eventType === 'payment.failed') {
      const email     = payload.customer?.email || '';
      const paymentId = payload.id || '';
      console.log(`[Webhook] ❌ Payment failed: ${email} (${paymentId})`);
    }

    // ─── license_key.created ────────────────────────────
    if (eventType === 'license_key.created') {
      const keyId  = payload.id || '';
      const status = payload.status || '';
      const custId = payload.customer_id || '';
      console.log(`[Webhook] 🔑 License key created: ${keyId} status=${status} customer=${custId}`);
    }

    // ─── license_key.updated ────────────────────────────
    if (eventType === 'license_key.updated') {
      const keyId     = payload.id || '';
      const status    = payload.status || '';
      const instances = payload.instances_count ?? '?';
      console.log(`[Webhook] 🔑 License key updated: ${keyId} status=${status} instances=${instances}`);
    }

    // Always return 200 quickly (required by Dodo)
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    return res.status(200).json({ received: true });
  }
}
