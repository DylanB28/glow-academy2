# Gem Glow Academy — production foundation

This repository contains the parent-owned membership flow, child PIN access, server-controlled gems, a 100-item palace shop and a saved drag-and-drop palace room.

## What changed

### Account flow

1. A parent creates a Supabase account.
2. The parent completes Stripe Checkout.
3. `success.html` verifies the checkout belongs to the signed-in parent and confirms the subscription server-side.
4. The parent is sent to `profile.html` to create one or more child profiles.
5. Each child receives a household family code, a profile name and a private four-digit PIN.
6. The child signs in through `child-login.html` and receives a signed, HTTP-only child session cookie.
7. Child sessions work on a separate device and do not require the parent Supabase session to be present.
8. Resetting a PIN increments the credential session version and immediately invalidates previous child sessions.

### Gems and palace

- Activity completions call the server and use the `complete_child_activity` database transaction.
- The same activity can award one gem per child per calendar day.
- A hard server-side limit prevents more than 20 gem-awarding completions per child per day.
- Gem awards, lifetime totals, room totals and streaks update atomically.
- Palace purchases use `purchase_reward_item`, which locks the wallet and validates ownership and price.
- The catalogue contains exactly 100 active items: five starter items and 95 purchasable items.
- Palace positions, scale, rotation and layer order are saved with `save_child_palace` in a single transaction. A failed save cannot erase the previous layout.
- Browser storage is a display cache only. It cannot award gems, grant ownership or activate membership.

## Required Supabase SQL

Run this file in the Supabase SQL editor before deploying the new application:

```text
supabase/migrations/001_production_foundation.sql
```

It creates or upgrades:

- `parent_profiles`
- `billing_customers`
- `subscriptions`
- `child_profiles`
- `child_credentials`
- `child_wallets`
- `reward_items`
- `child_inventory`
- `palace_placements`
- `activity_completions`
- `child_challenges`
- `child_challenge_checkins`
- `stripe_events`
- `child_login_attempts`
- `contact_submissions`

It also creates:

- `initialise_child_account()`
- `complete_child_activity(...)`
- `purchase_reward_item(...)`
- `rotate_child_pin(...)`
- `save_child_palace(...)`

The migration enables Row Level Security, removes broad anonymous/authenticated write access, adds parent read policies and restricts all currency/PIN/palace transaction functions to the server-side service role.

### Important migration order

1. Take a Supabase database backup.
2. Run the migration in a staging project first.
3. Confirm the final reward catalogue query returns 100:

```sql
select count(*) from public.reward_items where is_active = true;
```

4. Confirm each active child has a wallet and five starter inventory rows:

```sql
select c.id, c.display_name, w.gem_balance, count(i.id) as inventory_items
from public.child_profiles c
left join public.child_wallets w on w.child_id = c.id
left join public.child_inventory i on i.child_id = c.id
where c.status = 'active'
group by c.id, c.display_name, w.gem_balance;
```

5. Only then deploy the updated pages and APIs.

## Supabase browser configuration

Update `assets/supabase-config.js` with the public project URL and anon key only.

Never put any of the following in browser code:

- Supabase service-role key
- Stripe secret key
- Stripe webhook signing secret
- child-session secret
- Resend API key

In Supabase Authentication, configure the production site URL and allowed redirect URLs for the live domain and any controlled staging domain.

## Environment variables

Copy `.env.example` into the Vercel project settings and replace every placeholder.

Required:

- `APP_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CHILD_SESSION_SECRET` — at least 32 random characters
- `MAX_CHILDREN_PER_FAMILY`
- Stripe secret, webhook and price values for the selected mode
- `RESEND_API_KEY`
- `CONTACT_FROM_EMAIL`
- `CONTACT_TO_EMAIL`

Do not switch `STRIPE_TEST_MODE` to `false` until live products, prices and webhook secrets have been entered and live-mode checkout has been tested.

## Stripe setup

Create recurring monthly and annual prices and map them to the environment values. The browser sends only `monthly` or `annual`; it cannot choose an arbitrary Stripe price ID.

Create a Stripe webhook endpoint:

```text
https://YOUR_DOMAIN/api/stripe-webhook
```

Subscribe it to at least:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Test these flows in Stripe test mode:

1. New subscription.
2. Checkout refresh and repeated success-page verification.
3. Cancel at period end.
4. Immediate cancellation/deletion.
5. Failed renewal.
6. Recovered payment.
7. Billing portal payment-method update.
8. Duplicate webhook delivery.

The `stripe_events` table records event processing and makes retries safe.

## Parent and child UX checks

Before launch, test with at least two browsers and two devices:

1. Parent signs up and pays.
2. Parent creates three child profiles with different names and PINs.
3. A child signs in on a device where the parent has never signed in.
4. Incorrect PIN throttling activates after repeated failures.
5. Parent resets a PIN and the old child session is rejected.
6. Parent archives a child and that child can no longer access the dashboard.
7. Child completes an activity, refreshes and sees the same balance.
8. The same activity completed twice on the same day awards only once.
9. Two tabs complete different activities at nearly the same time without losing a gem.
10. Child buys an item and cannot buy it twice.
11. Child cannot buy an item without enough gems.
12. Child places, moves, resizes, rotates and removes items, saves, refreshes and sees the same palace.
13. A deliberately failed palace save preserves the previous saved layout.
14. Parent billing cancellation removes access when the paid period ends.

## Validation

Run:

```bash
npm install
npm test
npm audit --omit=dev
```

The project validator checks:

- JavaScript syntax, including inline page scripts
- local links and assets
- protected-page `noindex`
- absence of child-page behavioural analytics
- presence of all required SQL functions
- exactly 100 reward items
- accidental browser exposure of Stripe prices or server secrets

At the time of this update, the validator passes and `npm audit --omit=dev` reports zero known vulnerabilities.

## Deployment and security

`vercel.json` adds security headers, no-store API caching and a Content Security Policy suitable for the current static pages and Supabase browser client.

Recommended production additions:

- Vercel/Sentry error monitoring with alerts
- uptime monitoring for login, checkout and child dashboard endpoints
- database backups with a tested restore procedure
- a staging Vercel project connected to a separate Supabase and Stripe test environment
- structured product analytics designed for parents, with consent controls; do not add behavioural advertising analytics to child pages
- support response and safeguarding escalation procedures
- a Data Protection Impact Assessment and professional UK legal/privacy review

## Remaining scale item: audio

The current audio directory is approximately 61MB and includes one file of roughly 23MB. It works for a controlled beta but is inefficient for high traffic. Before significant paid acquisition:

1. Re-encode audio at an appropriate streaming bitrate.
2. Move the files to Supabase Storage or another CDN/object store.
3. Use cache headers and lazy loading.
4. Keep only short previews in the deployment bundle.

## Product behaviour after the original three rewards

The original three milestones are now encouragement markers rather than an ending. A child can continue earning gems and purchase from a permanent 100-item collection. When all current items are owned, the dashboard celebrates completion and keeps the wallet/history ready for future seasonal collections and additional palace rooms.

## Launch status

The repository now has a materially stronger production foundation, but no code-only review can truthfully certify a child-facing paid service without running the SQL in the real Supabase project and testing live integrations. Public launch should remain gated until:

- staging and live Stripe tests pass,
- Supabase RLS and transaction tests pass against the deployed database,
- legal and child-privacy review is complete,
- monitoring and restore procedures are active,
- and a controlled family beta demonstrates reliable activation and retention.
