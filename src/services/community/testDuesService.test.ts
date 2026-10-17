import { callTestDues, parseDuesResult, parseDuesStatus } from './testDuesService';

const value = () => ({
    schemaVersion: 1,
    observedAtMs: 1792152000000,
    active: false,
    accessThroughMs: null,
    order: null,
    waiver: { version: 'synthetic-dues-v1', text: 'SYNTHETIC TEST ONLY. No real waiver.' },
    offers: ['individual', 'family'].map((kind) => ({
        membershipDuesCheckoutSchemaVersion: 1,
        planRef: `dues-2026-${kind}-v1`,
        policyVersion: 'test-dues-calendar-v1',
        termId: 'calendar-2026',
        amountMinor: kind === 'individual' ? 2500 : 3000,
        currency: 'usd',
        startsAtMs: 1767254400000,
        endsAtMs: 1798790400000,
        offerable: true
    }))
});
test('parses only bounded test offers/status', () => {
    expect(parseDuesStatus(value()).offers).toHaveLength(2);
});
test.each([{ active: true },
    { accessThroughMs: 1798790400000 },
    { schemaVersion: 2 },
    { offers: [] },
    { arbitrary: 'data' }])('rejects unknown/inconsistent status %j', (patch) => {
    expect(() => parseDuesStatus({
        ...value(),
        ...patch
    })).toThrow();
});
test('rejects price drift, getters and duplicate plans', () => {
    const v = value();
    v.offers[0].amountMinor = 1;
    expect(() => parseDuesStatus(v)).toThrow();
    const getter = jest.fn();
    const a = value();
    Object.defineProperty(a, 'order', {
        get: getter,
        enumerable: true
    });
    expect(() => parseDuesStatus(a)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const b = value();
    [,
        b.offers[1]] = [null,
        b.offers[0]];
    expect(() => parseDuesStatus(b)).toThrow();
});
test('ephemeral URL must be test Checkout on an open order', () => {
    const order = {
        id: 'a'.repeat(64),
        state: 'open',
        offerId: 'dues-2026-individual-v1',
        amountMinor: 2500,
        currency: 'usd',
        endsAtMs: 1798790400000,
        familyId: null
    };
    expect(parseDuesResult({
        order,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_synthetic'
    }).checkoutUrl).toContain('cs_test_');
    ['https://evil.example/c/pay/cs_test_x',
        'https://checkout.stripe.com/c/pay/cs_live_x'].forEach((checkoutUrl) => {
        expect(() => parseDuesResult({
            order,
            checkoutUrl
        })).toThrow();
    });
    expect(() => parseDuesResult({
        order: {
            ...order,
            state: 'active'
        },
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x'
    })).toThrow();
});
test('default-off frontend cannot contact Firebase', async () => {
    await expect(callTestDues({ app: { options: { projectId: 'run-mprc-staging' } } } as any, { currentUser: null } as any, {
        action: 'status',
        accountUid: 'fictional'
    })).rejects.toThrow();
});
