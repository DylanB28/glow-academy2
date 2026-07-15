import Stripe from 'stripe';
import { requireMethod, sendJson, supabaseAdmin, verifyParentRequest } from './_lib/server.js';

const testMode = process.env.STRIPE_TEST_MODE === 'true';
const stripeKey = testMode ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(stripeKey || 'sk_test_missing');

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  try {
    const auth = await verifyParentRequest(req);
    if (!auth) return sendJson(res, 401, { error: 'Parent sign-in required.' });

    const { data, error } = await supabaseAdmin
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) return sendJson(res, 404, { error: 'No billing account was found.' });

    const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    const portal = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${appUrl}/profile.html`
    });
    return sendJson(res, 200, { url: portal.url });
  } catch (error) {
    console.error('[billing-portal]', error);
    return sendJson(res, 500, { error: 'Billing settings could not be opened.' });
  }
}
