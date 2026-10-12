import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import {
 act, fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { getMultiFactorResolver, signInWithEmailAndPassword, TotpMultiFactorGenerator } from 'firebase/auth';
import CommunityAdmin from './CommunityAdmin';
import { callAdministration } from '../../services/community/communityService';

let mockUser: any = { uid: 'officer' };
let mockEnabled = true;
const mockFunctions = { app: { options: { projectId: 'run-mprc-staging' } } };
const mockAuth = { app: { options: { projectId: 'run-mprc-staging' } } };
const mockSignOut = jest.fn();
jest.mock('../../services/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser, isLoading: false, signOut: mockSignOut }) }));
jest.mock('../../services/ServiceLocatorContext', () => ({ useServiceLocator: () => ({ services: { firebaseResources: { functions: mockFunctions, auth: mockAuth } } }) }));
jest.mock('../../services/community/communityService', () => ({ get COMMUNITY_ENABLED() { return mockEnabled; }, callAdministration: jest.fn() }));
jest.mock('firebase/auth', () => ({ signInWithEmailAndPassword: jest.fn(), getMultiFactorResolver: jest.fn(), TotpMultiFactorGenerator: { FACTOR_ID: 'totp', assertionForSignIn: jest.fn(() => 'synthetic-assertion') } }));
const call = callAdministration as jest.Mock;
const state = (extra = {}) => ({
 capabilities: { membershipApproval: true, freeEventManagement: true }, pending: [{ uid: 'runner', revision: 1, applicationStatus: 'pending' }], nextCursor: null, events: [], ...extra
});
const show = () => (
  <HelmetProvider>
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CommunityAdmin />
    </MemoryRouter>
  </HelmetProvider>
);
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterAll(() => { if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); else Reflect.deleteProperty(globalThis, 'crypto'); });
beforeEach(() => {
  jest.clearAllMocks(); mockEnabled = true; mockUser = { uid: 'officer' };
  mockFunctions.app.options.projectId = 'run-mprc-staging';
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' } });
  call.mockResolvedValue(state());
  (TotpMultiFactorGenerator.assertionForSignIn as jest.Mock).mockReturnValue('synthetic-assertion');
});
test('production and disabled flag make no call', () => {
  mockEnabled = false; const result = render(show()); expect(call).not.toHaveBeenCalled();
  mockEnabled = true; mockFunctions.app.options.projectId = 'production'; result.rerender(show()); expect(call).not.toHaveBeenCalled();
});
test('signed-out staging exposes a private MFA sign-in and makes no officer call', () => {
  mockUser = null; render(show()); expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password'); expect(call).not.toHaveBeenCalled();
});
test('approval uses target revision and fixed reason then rereads current authority', async () => {
  render(show()); const button = await screen.findByRole('button', { name: 'Approve test membership for runner' });
  call.mockResolvedValue(state({ pending: [] })); fireEvent.click(button);
  await screen.findByText('No pending requests.');
  expect(call.mock.calls[1][1]).toMatchObject({
 action: 'admin_membership_approve', accountUid: 'officer', targetUid: 'runner', expectedRevision: 1, reason: 'synthetic_staging_review'
});
  expect(call.mock.calls[2][1].action).toBe('admin_status');
});
test('unknown result hides projections and retry reuses exact command', async () => {
  render(show()); const button = await screen.findByRole('button', { name: 'Approve test membership for runner' });
  call.mockRejectedValueOnce(new Error('synthetic outage')); fireEvent.click(button);
  const retry = await screen.findByRole('button', { name: 'Retry saved action' });
  await screen.findByText(/Action could not be confirmed/);
  expect(screen.queryByText('Pending membership requests')).not.toBeInTheDocument();
  const command = call.mock.calls[1][1]; fireEvent.click(retry);
  await screen.findByText('Action confirmed. Current server status is shown.');
  expect(call.mock.calls[2][1]).toEqual(command);
});
test('service/account change discards obsolete privileged response', async () => {
  let resolve: (value: any) => void = () => undefined;
  call.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const result = render(show()); mockUser = { uid: 'other' }; call.mockResolvedValue(state({ pending: [] })); result.rerender(show());
  await screen.findByText('No pending requests.'); await act(async () => resolve(state()));
  expect(screen.queryByText('Test account: runner')).not.toBeInTheDocument();
});
test('permissions control minimum views without relying on browser admin role', async () => {
  call.mockResolvedValue(state({
    capabilities: { membershipApproval: false, freeEventManagement: true }, pending: [],
  })); render(show());
  await screen.findByText('Manage free test events'); expect(screen.queryByText('Pending membership requests')).not.toBeInTheDocument();
});
test('authenticator challenge clears passwords and resolves only TOTP', async () => {
  mockUser = null;
  const resolveSignIn = jest.fn().mockResolvedValue({});
  (signInWithEmailAndPassword as jest.Mock).mockRejectedValue({ code: 'auth/multi-factor-auth-required' });
  (getMultiFactorResolver as jest.Mock).mockReturnValue({ hints: [{ factorId: 'totp', uid: 'synthetic-factor' }], resolveSignIn });
  render(show()); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'synthetic@example.invalid' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-test-only' } }); fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  const code = await screen.findByLabelText('Authenticator code'); expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  fireEvent.change(code, { target: { value: '123456' } }); fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator code' }));
  await waitFor(() => expect(resolveSignIn).toHaveBeenCalledWith('synthetic-assertion'));
  expect(call).not.toHaveBeenCalled();
});
test('booked events disable content edits and cancelled events cannot reopen', async () => {
  call.mockResolvedValue(state({
 events: [{
 id: 'test-event', title: 'Synthetic run', location: 'Synthetic place', startAtMs: 1800000000000, opensAtMs: 1799990000000, closesAtMs: 1799999900000, capacity: 2, confirmedCount: 1, revision: 3, status: 'cancelled'
}]
}));
  render(show());
  expect(await screen.findByRole('button', { name: 'Edit Synthetic run' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open signup for Synthetic run' })).toBeDisabled();
  expect(screen.getByLabelText('Capacity for Synthetic run')).toHaveAttribute('min', '1');
});
