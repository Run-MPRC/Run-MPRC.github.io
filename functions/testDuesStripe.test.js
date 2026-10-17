'use strict';
jest.mock('stripe', () => jest.fn());
const Stripe = require('stripe');
const RealStripe = jest.requireActual('stripe');
const { createTestStripe, checkoutParameters, checkoutUrl } = require('./testDuesStripe');
let sdk; let adapter;
const secret = 'whsec_synthetic_only'; const account = 'acct_synthetic'; const id = 'a'.repeat(64); const nonce = 'b'.repeat(32);
const session = () => ({ object: 'checkout.session', id: 'cs_test_synthetic', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
  amount_total: 2500, currency: 'usd', payment_intent: 'pi_synthetic', client_reference_id: id,
  metadata: { schema: '1', purpose: 'membership_test_dues', order: id, nonce } });
const intent = () => ({ id: 'pi_synthetic', livemode: false, amount: 2500, amount_received: 2500, currency: 'usd', status: 'succeeded', latest_charge: {
  id: 'ch_synthetic', livemode: false, payment_intent: 'pi_synthetic', amount: 2500, currency: 'usd', disputed: false, amount_refunded: 0, paid: true } });
beforeEach(() => {
  sdk = { accounts: { retrieve: jest.fn(async () => ({ id: account })) }, checkout: { sessions: { create: jest.fn(async () => session()), retrieve: jest.fn(async () => session()), list: jest.fn(async () => ({ data: [session()], has_more: false })) } },
    paymentIntents: { retrieve: jest.fn(async () => intent()) }, charges: { retrieve: jest.fn(async () => ({ payment_intent: 'pi_synthetic', livemode: false })) }, webhooks: new RealStripe('sk_test_synthetic').webhooks };
  Stripe.mockImplementation(() => sdk); adapter = createTestStripe({ key: 'sk_test_synthetic', webhookSecret: secret, account });
});
test('server parameters use fixed URLs, exact integer cents and no member/customer metadata', () => {
  const p = checkoutParameters({ id, nonce, kind: 'individual', expiresAtMs: 1792155600000, expectation: { expectedAmountMinor: 2500, currency: 'usd' } });
  expect(p.line_items[0].price_data.unit_amount).toBe(2500); expect(p.metadata).toEqual({ schema: '1', purpose: 'membership_test_dues', order: id, nonce });
  expect(p.success_url).toBe(p.cancel_url); expect(p).not.toHaveProperty('customer_email'); expect(p).not.toHaveProperty('subscription_data');
});
test('paid projection verifies own account, session and current payment/charge without leaking PII', async () => {
  sdk.checkout.sessions.retrieve.mockResolvedValue({ ...session(), customer_details: { email: 'never-retain@example.invalid' } });
  expect(await adapter.retrieve('cs_test_synthetic')).toEqual({ checkoutRef: 'cs_test_synthetic', orderId: id, nonce, providerAccountRef: account, livemode: false, amountMinor: 2500, currency: 'usd', paymentRef: 'pi_synthetic', paid: true, reversal: false, expired: false });
});
test.each([{ livemode: true }, { mode: 'subscription' }, { amount_total: 2.5 }, { currency: 'eur' }, { client_reference_id: 'foreign' }, { metadata: { schema: '1' } }])('invalid session rejected %j', async patch => {
  sdk.checkout.sessions.retrieve.mockResolvedValue({ ...session(), ...patch }); await expect(adapter.retrieve('cs_test_synthetic')).rejects.toThrow();
});
test.each([{ livemode: true }, { amount: 1 }, { currency: 'eur' }])('invalid intent rejected %j', async patch => {
  sdk.paymentIntents.retrieve.mockResolvedValue({ ...intent(), ...patch }); await expect(adapter.retrieve('cs_test_synthetic')).rejects.toThrow();
});
test.each([{ amount_received: 0 }, { status: 'processing' }, { latest_charge: null }])('incomplete payment cannot activate %j', async patch => {
  sdk.paymentIntents.retrieve.mockResolvedValue({ ...intent(), ...patch }); expect((await adapter.retrieve('cs_test_synthetic')).paid).toBe(false);
});
test.each([{ amount_refunded: 100 }, { disputed: true }])('current reversal detected before older completion %j', async patch => {
  const pi = intent(); pi.latest_charge = { ...pi.latest_charge, ...patch }; sdk.paymentIntents.retrieve.mockResolvedValue(pi);
  expect(await adapter.retrieve('cs_test_synthetic')).toMatchObject({ paid: false, reversal: true });
});
test('wrong actual Stripe account and live secret rejected', async () => {
  sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_foreign' }); await expect(adapter.retrieve('cs_test_synthetic')).rejects.toThrow();
  expect(() => createTestStripe({ key: 'sk_live_synthetic', webhookSecret: secret, account })).toThrow();
});
test('raw signed webhook verified; invalid, stale, live, wrong-account and oversized payloads reject', () => {
  const event = { id: 'evt_synthetic', type: 'checkout.session.completed', livemode: false, data: { object: session() } };
  const signed = e => { const raw = Buffer.from(JSON.stringify(e)); const signature = sdk.webhooks.generateTestHeaderString({ payload: raw.toString(), secret }); return [raw, signature]; };
  expect(adapter.verify(...signed(event))).toEqual({ id: event.id, type: event.type, reference: { kind: 'session', id: session().id } });
  expect(() => adapter.verify(...signed({ ...event, livemode: true }))).toThrow();
  expect(() => adapter.verify(...signed({ ...event, account: 'acct_other' }))).toThrow();
  expect(() => adapter.verify(Buffer.from('{}'), 'invalid')).toThrow();
  expect(() => adapter.verify(Buffer.alloc(65537), 'invalid')).toThrow();
  const [raw] = signed(event); expect(() => adapter.verify(raw, sdk.webhooks.generateTestHeaderString({ payload: raw.toString(), secret, timestamp: 1 }))).toThrow();
});
test('refund/dispute resolves exact same-account checkout even before completed event is stored', async () => {
  expect(await adapter.resolve({ kind: 'charge', id: 'ch_synthetic' })).toMatchObject({ orderId: id });
  expect(sdk.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: 'pi_synthetic', limit: 2 });
  sdk.checkout.sessions.list.mockResolvedValue({ data: [session(), session()], has_more: false }); await expect(adapter.resolve({ kind: 'charge', id: 'ch_synthetic' })).rejects.toThrow();
});
test('only ephemeral test Checkout URL can be returned', () => {
  expect(checkoutUrl('https://checkout.stripe.com/c/pay/cs_test_synthetic')).toContain('cs_test_');
  for (const url of ['https://checkout.stripe.com.evil/c/pay/cs_test_x', 'https://checkout.stripe.com/c/pay/cs_live_x', 'http://checkout.stripe.com/c/pay/cs_test_x', 'https://user@checkout.stripe.com/c/pay/cs_test_x']) expect(() => checkoutUrl(url)).toThrow();
});

test.each([-1, 1.5, 2501])('malformed refunded amount rejects without activation: %s', async amount => {
  const pi = intent(); pi.latest_charge.amount_refunded = amount;
  sdk.paymentIntents.retrieve.mockResolvedValue(pi);
  await expect(adapter.retrieve('cs_test_synthetic')).rejects.toThrow();
});
test('Checkout URL must point at the verified exact Session', async () => {
  sdk.checkout.sessions.retrieve.mockResolvedValue({ ...session(), status: 'open', payment_status: 'unpaid', payment_intent: null, url: 'https://checkout.stripe.com/c/pay/cs_test_foreign' });
  await expect(adapter.retrieve('cs_test_synthetic', true)).rejects.toThrow();
});
