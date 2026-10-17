'use strict';
// No logging or raw provider persistence. This adapter uses only the existing SDK.
const Stripe = require('stripe');
const { check, RETURN_URL } = require('./testDuesPolicy');
const ref = (s, prefix) => typeof s === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,120}$`).test(s);
function checkoutUrl(url, sessionId) {
  try { const u = new URL(url); check(u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.username && !u.password && !u.port && u.pathname.startsWith('/c/pay/cs_test_') && (!sessionId || u.pathname === `/c/pay/${sessionId}`)); return url; } catch { check(false); }
}
function checkoutParameters(o) {
  return { mode: 'payment', payment_method_types: ['card'], client_reference_id: o.id,
    metadata: { schema: '1', purpose: 'membership_test_dues', order: o.id, nonce: o.nonce },
    line_items: [{ quantity: 1, price_data: { currency: o.expectation.currency, unit_amount: o.expectation.expectedAmountMinor,
      product_data: { name: `TEST ONLY: ${o.kind} annual membership` } } }],
    success_url: RETURN_URL, cancel_url: RETURN_URL, expires_at: Math.floor(o.expiresAtMs / 1000),
    allow_promotion_codes: false, automatic_tax: { enabled: false },
  };
}
function createTestStripe({ key, webhookSecret, account }) {
  check(typeof key === 'string' && (key.startsWith('rk_test_') || key.startsWith('sk_test_')) && typeof webhookSecret === 'string' && webhookSecret.startsWith('whsec_') && ref(account, 'acct'));
  const stripe = new Stripe(key, { apiVersion: '2023-10-16', timeout: 5000, maxNetworkRetries: 0 });
  async function own() { const a = await stripe.accounts.retrieve(); check(a.id === account); }
  async function project(s, includeUrl = false) {
    check(ref(s.id, 'cs_test') && s.object === 'checkout.session' && s.livemode === false && s.mode === 'payment'
      && ['open', 'complete', 'expired'].includes(s.status) && ['paid', 'unpaid', 'no_payment_required'].includes(s.payment_status)
      && Number.isSafeInteger(s.amount_total) && s.currency === 'usd'
      && s.metadata?.schema === '1' && s.metadata?.purpose === 'membership_test_dues'
      && /^[a-f0-9]{64}$/.test(s.metadata.order) && /^[a-f0-9]{32}$/.test(s.metadata.nonce)
      && s.client_reference_id === s.metadata.order);
    let paid = false; let reversal = false; let paymentRef = null;
    if (s.payment_intent) {
      check(ref(s.payment_intent, 'pi'));
      const pi = await stripe.paymentIntents.retrieve(s.payment_intent, { expand: ['latest_charge'] });
      check(pi.id === s.payment_intent && pi.livemode === false && pi.amount === s.amount_total && pi.currency === s.currency);
      const c = pi.latest_charge;
      if (c) {
        check(typeof c === 'object' && ref(c.id, 'ch') && c.livemode === false && c.payment_intent === pi.id
          && c.amount === s.amount_total && c.currency === s.currency && typeof c.disputed === 'boolean' && Number.isSafeInteger(c.amount_refunded) && c.amount_refunded >= 0 && c.amount_refunded <= c.amount);
        reversal = c.disputed || c.amount_refunded > 0;
      }
      paid = s.status === 'complete' && s.payment_status === 'paid' && pi.status === 'succeeded'
        && pi.amount_received === s.amount_total && c?.paid === true && !reversal;
      paymentRef = pi.id;
    }
    return { checkoutRef: s.id, orderId: s.metadata.order, nonce: s.metadata.nonce, providerAccountRef: account,
      livemode: false, amountMinor: s.amount_total, currency: s.currency, paymentRef, paid, reversal,
      expired: s.status === 'expired' && s.payment_status === 'unpaid' && !s.payment_intent,
      ...(includeUrl && s.status === 'open' && s.url ? { url: checkoutUrl(s.url, s.id) } : {}),
    };
  }
  return {
    async create(order) { await own(); return project(await stripe.checkout.sessions.create(checkoutParameters(order), { idempotencyKey: order.id }), true); },
    async retrieve(id, includeUrl = false) { check(ref(id, 'cs_test')); await own(); return project(await stripe.checkout.sessions.retrieve(id), includeUrl); },
    async resolve(reference) {
      await own();
      if (reference.kind === 'session') return project(await stripe.checkout.sessions.retrieve(reference.id));
      let pi = reference.id;
      if (reference.kind === 'charge') { const c = await stripe.charges.retrieve(reference.id); check(c.livemode === false && ref(c.payment_intent, 'pi')); pi = c.payment_intent; }
      check(ref(pi, 'pi'));
      const result = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 2 });
      check(result.data.length === 1 && !result.has_more);
      return project(result.data[0]);
    },
    verify(raw, signature) {
      check(Buffer.isBuffer(raw) && raw.length <= 65536 && typeof signature === 'string' && signature.length <= 2048, 'invalid-argument');
      let event; try { event = stripe.webhooks.constructEvent(raw, signature, webhookSecret); } catch { check(false, 'invalid-argument'); }
      check(event.livemode === false && (!event.account || event.account === account) && ref(event.id, 'evt'), 'invalid-argument');
      const object = event.data?.object; let reference;
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
        check(object?.livemode === false && ref(object.id, 'cs_test'), 'invalid-argument'); reference = { kind: 'session', id: object.id };
      } else if (event.type === 'charge.refunded') {
        check(object?.livemode === false && ref(object.id, 'ch'), 'invalid-argument'); reference = { kind: 'charge', id: object.id };
      } else if (['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'].includes(event.type)) {
        check(object?.livemode === false && ref(object.charge, 'ch'), 'invalid-argument'); reference = { kind: 'charge', id: object.charge };
      } else return null;
      return { id: event.id, type: event.type, reference };
    },
  };
}
module.exports = { createTestStripe, checkoutParameters, checkoutUrl };
