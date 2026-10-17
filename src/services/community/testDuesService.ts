import { httpsCallable, Functions } from 'firebase/functions';
import { Auth } from 'firebase/auth';
import { COMMUNITY_ENABLED } from './communityService';

export const TEST_DUES_ENABLED = COMMUNITY_ENABLED
    && process.env.REACT_APP_TEST_DUES_STAGING === 'true';
export type DuesRequest = {
    action: 'status' | 'prepare' | 'resume' | 'reconcile';
    accountUid: string;
    requestId?: string;
    offerId?: string;
    waiverVersion?: string;
    waiverAccepted?: true;
};
export type DuesOrder = {
    id: string;
    state: 'prepared' | 'open' | 'expired' | 'paid_pending_activation' | 'active' | 'held';
    offerId: string;
    amountMinor: number;
    currency: 'usd';
    endsAtMs: number;
    familyId: string | null;
};
export type DuesOffer = {
    planRef: string;
    amountMinor: number;
    currency: 'usd';
    startsAtMs: number;
    endsAtMs: number;
    offerable: boolean;
};
export type DuesStatus = {
    schemaVersion: 1;
    observedAtMs: number;
    offers: DuesOffer[];
    waiver: {
        version: string;
        text: string;
    };
    active: boolean;
    accessThroughMs: number | null;
    order: DuesOrder | null;
};
const check = (v: unknown) => { if (!v) throw new Error('Test dues status is unavailable.'); };
const integer = (v: unknown): v is number => typeof v === 'number'
    && Number.isSafeInteger(v)
    && v >= 0
    && v <= 8640000000000000;
function object(v: unknown, keys: string[], optional: string[] = []): Record<string, any> {
    check(v !== null
        && typeof v === 'object'
        && !Array.isArray(v)
        && Object.getPrototypeOf(v) === Object.prototype);
    const d = Object.getOwnPropertyDescriptors(v);
    check(keys.every((k) => Object.prototype.hasOwnProperty.call(d, k))
        && Reflect.ownKeys(d).every((k) => typeof k === 'string'
            && [...keys,
                ...optional].includes(k)
            && d[k].enumerable
            && Object.prototype.hasOwnProperty.call(d[k], 'value')));
    return Object.fromEntries(Object.entries(d).map(([k, p]) => [k, p.value]));
}
function offerId(v: unknown): v is string {
    return typeof v === 'string'
        && /^dues-\d{4}-(individual|family)-v1$/.test(v);
}
function price(v: Record<string, any>) {
    check(offerId(v.offerId ?? v.planRef) && v.currency === 'usd'
        && v.amountMinor === (String(v.offerId ?? v.planRef).includes('-individual-') ? 2500 : 3000));
}
function order(v: unknown): DuesOrder | null {
    if (v === null) return null;
    const o = object(v, ['id',
        'state',
        'offerId',
        'amountMinor',
        'currency',
        'endsAtMs',
        'familyId']);
    price(o);
    check(typeof o.id === 'string' && /^[a-f0-9]{64}$/.test(o.id) && integer(o.endsAtMs)
        && ['prepared',
            'open',
            'expired',
            'paid_pending_activation',
            'active',
            'held'].includes(o.state)
        && (o.familyId === null
            || (o.state === 'active'
                && o.offerId.includes('-family-')
                && o.familyId === `family-${o.id.slice(0, 32)}`)));
    return o as DuesOrder;
}
export function parseDuesStatus(v: unknown): DuesStatus {
    try {
        const s = object(v, ['schemaVersion',
            'observedAtMs',
            'offers',
            'waiver',
            'active',
            'accessThroughMs',
            'order']);
        check(s.schemaVersion === 1 && integer(s.observedAtMs) && typeof s.active === 'boolean'
            && (s.active ? integer(s.accessThroughMs)
                && s.accessThroughMs > s.observedAtMs : s.accessThroughMs === null));
        check(Array.isArray(s.offers));
        const entries = Object.getOwnPropertyDescriptors(s.offers);
        check(entries.length?.value === 2 && Reflect.ownKeys(entries).length === 3);
        const plans = [0, 1].map((index) => {
            const descriptor = entries[String(index)];
            check(descriptor?.enumerable
                && Object.prototype.hasOwnProperty.call(descriptor, 'value'));
            const p = object(descriptor.value, ['membershipDuesCheckoutSchemaVersion',
                'planRef',
                'policyVersion',
                'termId',
                'amountMinor',
                'currency',
                'startsAtMs',
                'endsAtMs',
                'offerable']);
            price(p);
            check(p.membershipDuesCheckoutSchemaVersion === 1
                && p.policyVersion === 'test-dues-calendar-v1'
                && p.termId === `calendar-${p.planRef.slice(5, 9)}`
                && integer(p.startsAtMs)
                && integer(p.endsAtMs)
                && p.startsAtMs <= s.observedAtMs
                && s.observedAtMs < p.endsAtMs
                && typeof p.offerable === 'boolean');
            return p as DuesOffer;
        });
        check(plans[0].planRef !== plans[1].planRef
            && plans[0].startsAtMs === plans[1].startsAtMs
            && plans[0].endsAtMs === plans[1].endsAtMs);
        const w = object(s.waiver, ['version', 'text']);
        check(w.version === 'synthetic-dues-v1'
            && typeof w.text === 'string'
            && w.text.length <= 2000
            && w.text.startsWith('SYNTHETIC TEST ONLY.'));
        return {
            schemaVersion: 1,
            observedAtMs: s.observedAtMs,
            offers: plans,
            waiver: {
                version: w.version,
                text: w.text
            },
            active: s.active,
            accessThroughMs: s.accessThroughMs,
            order: order(s.order)
        };
    }
    catch {
        throw new Error('Test dues status is unavailable.');
    }
}
export function parseDuesResult(v: unknown): {
    order: DuesOrder;
    checkoutUrl?: string;
} {
    const r = object(v, ['order'], ['checkoutUrl']);
    const o = order(r.order);
    check(o);
    if (r.checkoutUrl !== undefined) {
        check(o?.state === 'open' && typeof r.checkoutUrl === 'string' && r.checkoutUrl.length <= 4096);
        const u = new URL(r.checkoutUrl);
        check(u.protocol === 'https:'
            && u.hostname === 'checkout.stripe.com'
            && !u.username
            && !u.password
            && !u.port
            && u.pathname.startsWith('/c/pay/cs_test_'));
    }
    return { order: o as DuesOrder, ...(r.checkoutUrl ? { checkoutUrl: r.checkoutUrl } : {}) };
}
export async function callTestDues(
  functions: Functions,
  auth: Auth,
  request: DuesRequest,
): Promise<unknown> {
    const user = auth.currentUser;
    const bound = () => TEST_DUES_ENABLED
        && functions.app.options.projectId === 'run-mprc-staging'
        && auth.app === functions.app
        && auth.tenantId === null
        && user
        && auth.currentUser === user
        && user.uid === request.accountUid
        && user.emailVerified;
    if (!bound()) throw new Error('Test dues are unavailable.');
    const result = await httpsCallable<DuesRequest, unknown>(functions, 'membershipTestDues')(request);
    if (!bound()) throw new Error('Test dues are unavailable.');
    return result.data;
}
export function openTestCheckout(url: string) { window.location.assign(url); }
