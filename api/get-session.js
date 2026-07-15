import Stripe from 'stripe';
import { requireMethod, sendJson, supabaseAdmin, verifyParentRequest } from './_lib/server.js';

const testMode = process.env.STRIPE_TEST_MODE === 'true';
const stripeKey = testMode ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(stripeKey || 'sk_test_missing');

async function syncSubscription(session, userId) {
  if (session.mode !== 'subscription' || !session.subscription) return null;
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const priceId = subscription.items.data[0]?.price?.id || null;
  const planCode = subscription.metadata?.plan_code || session.metadata?.plan_code || null;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: String(session.customer),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_id: priceId,
    plan_code: planCode,
    current_period_end: periodEnd,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;

  await supabaseAdmin.from('billing_customers').upsert({
    user_id: userId,
    stripe_customer_id: String(session.customer)
  }, { onConflict: 'user_id' });

  return subscription;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
    const auth = await verifyParentRequest(req);
    if (!auth) return sendJson(res, 401, { error: 'Please sign in to confirm your membership.' });

    const sessionId = String(req.query?.session_id || '');
    if (!sessionId.startsWith('cs_')) return sendJson(res, 400, { error: 'Invalid checkout session.' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const sessionUserId = session.client_reference_id || session.metadata?.user_id;
    if (sessionUserId !== auth.user.id) return sendJson(res, 403, { error: 'This checkout does not belong to your account.' });
    if (session.status !== 'complete') return sendJson(res, 409, { active: false, error: 'Checkout is not complete yet.' });

    const subscription = await syncSubscription(session, auth.user.id);
    const active = Boolean(subscription && ['active', 'trialing'].includes(subscription.status));

    return sendJson(res, 200, {
      active,
      customerName: session.customer_details?.name || auth.user.user_metadata?.full_name || 'Member',
      subscriptionStatus: subscription?.status || 'unknown'
    });
  } catch (error) {
    console.error('[get-session]', error);
    return sendJson(res, 500, { error: 'Membership confirmation failed.' });
  }
}
