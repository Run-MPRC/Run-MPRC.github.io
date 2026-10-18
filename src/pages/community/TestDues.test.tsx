import React from 'react';
import {
 act, fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import TestDues from './TestDues';
import { callTestDues, openTestCheckout } from '../../services/community/testDuesService';

let mockUser: any;
let mockAuth: any;
let mockServices: any;
let mockCallback: (u: any) => void;
const mockApp = { options: { projectId: 'run-mprc-staging' } };
jest.mock('firebase/auth', () => ({
    onIdTokenChanged: (auth: any, cb: (u: any) => void) => {
        mockCallback = cb;
        cb(auth.currentUser);
        return jest.fn();
    }
}));
jest.mock('../../services/hooks/useAuth', () => ({
    useAuth: () => ({
        user: mockUser,
        isLoading: false
    })
}));
jest.mock('../../services/ServiceLocatorContext', () => ({ useServiceLocator: () => ({ services: mockServices }) }));
jest.mock('../../services/community/testDuesService', () => ({
    ...jest.requireActual('../../services/community/testDuesService'),
    TEST_DUES_ENABLED: true,
    callTestDues: jest.fn(),
    openTestCheckout: jest.fn()
}));
const call = callTestDues as jest.Mock;
const state = () => ({
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
const order = {
    id: 'a'.repeat(64),
    state: 'open',
    offerId: 'dues-2026-individual-v1',
    amountMinor: 2500,
    currency: 'usd',
    endsAtMs: 1798790400000,
    familyId: null
};
const show = () => (
  <HelmetProvider>
    <MemoryRouter future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
    }}
    >
      <TestDues />
    </MemoryRouter>
  </HelmetProvider>
);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: 'fictional' };
    mockAuth = {
        app: mockApp,
        tenantId: null,
        currentUser: {
            uid: 'fictional',
            emailVerified: true
        }
    };
    mockServices = {
        firebaseResources: {
            auth: mockAuth,
            functions: { app: mockApp }
        }
    };
    call.mockResolvedValue(state());
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' }
    });
});
afterEach(() => { jest.useRealTimers(); });
afterAll(() => {
    if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
    else {
        Reflect.deleteProperty(globalThis, 'crypto');
    }
});
test('signed-out page calls no backend', () => {
    mockUser = null;
    mockAuth.currentUser = null;
    render(show());
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
});
test('consent precedes server-priced test checkout and redirects only to verified response', async () => {
    render(show());
    const button = await screen.findByRole('button', { name: 'Continue to individual test checkout' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    call.mockResolvedValueOnce({
        order,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_synthetic'
    });
    fireEvent.click(button);
    await waitFor(() => expect(openTestCheckout).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_synthetic'));
    expect(call.mock.calls[1][2]).toEqual({
        action: 'prepare',
        accountUid: 'fictional',
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        offerId: 'dues-2026-individual-v1',
        waiverVersion: 'synthetic-dues-v1',
        waiverAccepted: true
    });
});
test('lost prepare retains exact request; retry does not create another ID or trust return query', async () => {
    render(show());
    const button = await screen.findByRole('button', { name: 'Continue to individual test checkout' });
    fireEvent.click(screen.getByRole('checkbox'));
    call.mockRejectedValueOnce(new Error('uncertain'));
    fireEvent.click(button);
    const retry = await screen.findByRole('button', { name: 'Retry saved request' });
    await waitFor(() => expect(retry).toBeEnabled());
    const saved = call.mock.calls[1][2];
    call.mockResolvedValueOnce({ order }).mockResolvedValueOnce({
        ...state(),
        order
    });
    fireEvent.click(retry);
    await screen.findByText('Your saved purchase');
    expect(call.mock.calls[2][2]).toEqual(saved);
    expect(openTestCheckout).not.toHaveBeenCalled();
});
test('reload recovers server order; no new-purchase controls while pending', async () => {
    call.mockResolvedValue({
        ...state(),
        order
    });
    render(show());
    await screen.findByText('Your saved purchase');
    expect(screen.getByRole('button', { name: 'Resume saved checkout' })).toBeEnabled();
    expect(screen.queryByText('Continue to individual test checkout')).not.toBeInTheDocument();
});
test('same-UID new session discards late result and saved consent', async () => {
    let resolve: (v: any) => void = () => { };
    call.mockReturnValueOnce(new Promise((r) => {
        resolve = r;
    }));
    render(show());
    call.mockRejectedValue(new Error('unavailable'));
    await act(async () => {
        mockCallback(mockAuth.currentUser);
    });
    await act(async () => {
        resolve(state());
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('deadline removes controls without polling', async () => {
    jest.useFakeTimers();
    render(show());
    await screen.findByRole('checkbox');
    const calls = call.mock.calls.length;
    act(() => {
        jest.advanceTimersByTime(60001);
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(call).toHaveBeenCalledTimes(calls);
});
test('bad response hides all purchase controls', async () => {
    call.mockResolvedValue({
        ...state(),
        unexpected: true
    });
    render(show());
    await screen.findByText(/We could not confirm/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('after a paid year ends the current-year offer is available without showing old access', async () => {
  const now = 1798790400000;
  const next = { ...state(), observedAtMs: now, order: { ...order, state: 'active', endsAtMs: now } };
  next.offers = next.offers.map((p) => ({
 ...p,
planRef: p.planRef.replace('2026', '2027'),
    termId: 'calendar-2027',
startsAtMs: now,
endsAtMs: 1830326400000
}));
  call.mockResolvedValue(next); render(show());
  expect(await screen.findByRole('button', { name: 'Continue to individual test checkout' })).toBeDisabled();
  expect(screen.getByText('Payment confirmed. That term has ended.')).toBeInTheDocument();
  expect(screen.queryByText('Your test membership is active.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Continue to individual test checkout' })).toBeEnabled();
});
test('an unbound prepared order offers resume rather than a doomed payment check', async () => {
  call.mockResolvedValue({ ...state(), order: { ...order, state: 'prepared' } }); render(show());
  expect(await screen.findByRole('button', { name: 'Resume saved checkout' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Check payment status' })).not.toBeInTheDocument();
});

const recoveryMessage = 'Checkout could not be reopened. Keep this saved purchase and ask the test owner for reconciliation. Do not start another payment.';
test('resume without a Checkout URL explains the retained open purchase without navigation or prepare', async () => {
    call.mockResolvedValue({ ...state(), order });
    render(show());
    const resume = await screen.findByRole('button', { name: 'Resume saved checkout' });
    call.mockResolvedValueOnce({ order });
    fireEvent.click(resume);
    expect(await screen.findByText(recoveryMessage)).toBeInTheDocument();
    expect(screen.getByText('Status: open.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(openTestCheckout).not.toHaveBeenCalled();
    expect(call.mock.calls.map((c) => c[2])).toEqual([
        { action: 'status', accountUid: 'fictional' },
        { action: 'resume', accountUid: 'fictional' },
        { action: 'status', accountUid: 'fictional' }
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findByText('Current test status loaded.');
    expect(screen.queryByText(recoveryMessage)).not.toBeInTheDocument();
});
test.each(['active', 'held'])('fresh %s status supersedes an earlier open resume result', async (nextState) => {
    call.mockResolvedValue({ ...state(), order });
    render(show());
    const resume = await screen.findByRole('button', { name: 'Resume saved checkout' });
    call.mockResolvedValueOnce({ order }).mockResolvedValueOnce({
        ...state(), order: { ...order, state: nextState },
        active: nextState === 'active',
        accessThroughMs: nextState === 'active' ? order.endsAtMs : null
    });
    fireEvent.click(resume);
    await screen.findByText('Current test status loaded.');
    expect(screen.queryByText(recoveryMessage)).not.toBeInTheDocument();
    expect(screen.getByText(`Status: ${nextState}.`)).toBeInTheDocument();
    expect(openTestCheckout).not.toHaveBeenCalled();
});
test.each(['session', 'account'])('%s changes discard a pending resume message and the displayed message', async (change) => {
    call.mockResolvedValue({ ...state(), order });
    const view = render(show());
    const resume = await screen.findByRole('button', { name: 'Resume saved checkout' });
    call.mockResolvedValueOnce({ order });
    fireEvent.click(resume);
    await screen.findByText(recoveryMessage);
    let resolve: (v: any) => void = () => {};
    call.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume saved checkout' }));
    call.mockResolvedValue(state());
    await act(async () => {
        if (change === 'account') mockUser = { uid: 'another-fictional' };
        mockAuth.currentUser = { uid: mockUser.uid, emailVerified: true };
        mockCallback(mockAuth.currentUser);
        view.rerender(show());
    });
    await screen.findByRole('checkbox');
    await act(async () => { resolve({ order }); });
    expect(screen.queryByText(recoveryMessage)).not.toBeInTheDocument();
    expect(screen.queryByText('Your saved purchase')).not.toBeInTheDocument();
    expect(openTestCheckout).not.toHaveBeenCalled();
});
