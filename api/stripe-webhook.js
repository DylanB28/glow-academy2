import Stripe from 'stripe';
import { supabaseAdmin } from './_lib/server.js';

export const config = { api: { bodyParser: false } };

const testMode = process.env.STRIPE_TEST_MODE === 'true';
const stripeKey = testMode ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
const webhookSecret = testMode ? process.env.STRIPE_WEBHOOK_SECRET_TEST : process.env.STRIPE_WEBHOOK_SECRET;
const stripe = new Stripe(stripeKey || 'sk_test_missing');

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function resolveUserId(subscription, fallbackUserId = null) {
  if (fallbackUserId) return fallbackUserId;
  if (subscription.metadata?.user_id) return subscription.metadata.user_id;
  const { data, error } = await supabaseAdmin
    .from('billing_customers')
    .select('user_id')
    .eq('stripe_customer_id', String(subscription.customer))
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function storeSubscription(subscription, userId) {
  const priceId = subscription.items.data[0]?.price?.id || null;
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_id: priceId,
    plan_code: subscription.metadata?.plan_code || null,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;

  const { error: customerError } = await supabaseAdmin.from('billing_customers').upsert({
    user_id: userId,
    stripe_customer_id: String(subscription.customer)
  }, { onConflict: 'user_id' });
  if (customerError) throw customerError;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!webhookSecret || !req.headers['stripe-signature']) return res.status(400).json({ error: 'Webhook is not configured.' });

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], webhookSecret);
  } catch (error) {
    console.error('[stripe-webhook] signature', error.message);
    return res.status(400).send('Invalid signature');
  }

  try {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('stripe_events')
      .select('event_id,processed_at')
      .eq('event_id', event.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.processed_at) return res.status(200).json({ received: true, duplicate: true });

    await supabaseAdmin.from('stripe_events').upsert({
      event_id: event.id,
      event_type: event.type,
      livemode: event.livemode,
      received_at: new Date().toISOString()
    }, { onConflict: 'event_id' });

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.user_id;
      if (userId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await storeSubscription(subscription, userId);
      }
    }

    if ([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ].includes(event.type)) {
      const subscription = event.data.object;
      const userId = await resolveUserId(subscription);
      if (!userId) throw new Error(`No user found for Stripe customer ${subscription.customer}`);
      await storeSubscription(subscription, userId);
    }

    if (['invoice.payment_failed', 'invoice.paid'].includes(event.type)) {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = await resolveUserId(subscription);
        if (userId) await storeSubscription(subscription, userId);
      }
    }

    await supabaseAdmin.from('stripe_events').update({
      processed_at: new Date().toISOString(),
      processing_error: null
    }).eq('event_id', event.id);

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[stripe-webhook] processing', error);
    await supabaseAdmin.from('stripe_events').upsert({
      event_id: event.id,
      event_type: event.type,
      livemode: event.livemode,
      processing_error: String(error.message || error).slice(0, 1000),
      received_at: new Date().toISOString()
    }, { onConflict: 'event_id' });
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }
}
