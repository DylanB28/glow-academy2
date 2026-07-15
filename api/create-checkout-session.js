import crypto from 'crypto';
import Stripe from 'stripe';
import {
  getSubscriptionAccess,
  requireMethod,
  sendJson,
  supabaseAdmin,
  verifyParentRequest
} from './_lib/server.js';

const testMode = process.env.STRIPE_TEST_MODE === 'true';
const stripeKey = testMode ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(stripeKey || 'sk_test_missing');

function priceMap() {
  return {
    monthly: testMode
      ? process.env.STRIPE_PRICE_MONTHLY_TEST
      : process.env.STRIPE_PRICE_MONTHLY,
    annual: testMode
      ? process.env.STRIPE_PRICE_ANNUAL_TEST
      : process.env.STRIPE_PRICE_ANNUAL
  };
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  try {
    const auth = await verifyParentRequest(req);
    if (!auth) return sendJson(res, 401, { error: 'Please sign in before starting checkout.' });

    const plan = String(req.body?.plan || '').toLowerCase();
    const prices = priceMap();
    const priceId = prices[plan];
    if (!['monthly', 'annual'].includes(plan) || !priceId) {
      return sendJson(res, 400, { error: 'That plan is not configured.' });
    }

    const existingAccess = await getSubscriptionAccess(auth.user.id);
    if (existingAccess.active) {
      return sendJson(res, 409, { error: 'Your membership is already active.', redirect: '/profile.html' });
    }

    let customerId = existingAccess.subscription?.stripe_customer_id || null;
    if (!customerId) {
      const { data: customerRow, error: customerReadError } = await supabaseAdmin
        .from('billing_customers')
        .select('stripe_customer_id')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (customerReadError) throw customerReadError;
      customerId = customerRow?.stripe_customer_id || null;
    }

    if (!customerId) {
      const customerKey = crypto.createHash('sha256').update(`customer:${auth.user.id}`).digest('hex');
      const customer = await stripe.customers.create({
        email: auth.user.email,
        metadata: { user_id: auth.user.id }
      }, { idempotencyKey: customerKey });
      customerId = customer.id;
      const { error: customerSaveError } = await supabaseAdmin
        .from('billing_customers')
        .upsert({ user_id: auth.user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
      if (customerSaveError) throw customerSaveError;
    }

    const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    if (!/^https?:\/\//.test(appUrl)) throw new Error('APP_URL is not configured.');

    const idempotencyWindow = Math.floor(Date.now() / (5 * 60 * 1000));
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${auth.user.id}:${plan}:${idempotencyWindow}`)
      .digest('hex');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: auth.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: { metadata: { user_id: auth.user.id, plan_code: plan } },
      metadata: { user_id: auth.user.id, plan_code: plan },
      success_url: `${appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/signup.html?checkout=cancelled`
    }, { idempotencyKey });

    return sendJson(res, 200, { url: session.url });
  } catch (error) {
    console.error('[checkout]', error);
    return sendJson(res, 500, { error: 'Checkout could not be started. Please try again.' });
  }
}
