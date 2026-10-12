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
const duesState = (extra = {}) => state({
 capabilities: { membershipApproval: false, freeEventManagement: false, duesRecording: true },
pending: [],
  dues: [],
duesPolicy: {
 revision: 3, amountCents: 100, currency: 'USD', method: 'fictional_external', termId: 'fictional-term', startsAtMs: 1800000000000, endsAtMs: 1800000060000
},
duesRecordingOpen: true,
nextDuesCursor: null,
...extra
});
const linkId = `stage_dues_${'a'.repeat(64)}`;
const linkReceipt = {
 membershipId: linkId, amountCents: 100, currency: 'USD', method: 'fictional_external', termId: 'fictional-term', startsAtMs: 1800000000000, endsAtMs: 1800000060000, linked: false
};
const linkState = (extra = {}) => duesState({
  capabilities: {
 membershipApproval: false,
 freeEventManagement: false,
 duesRecording: false,
 membershipAssociation: true,
},
  dues: [linkReceipt],
duesPolicy: null,
duesRecordingOpen: false,
...extra,
});
async function fillLink() {
  fireEvent.change(await screen.findByLabelText('Fictional receipt to link'), { target: { value: linkId } });
  fireEvent.change(screen.getByLabelText('Disposable account ID'), { target: { value: 'disposable-member' } });
  fireEvent.change(screen.getByLabelText('Pending membership revision'), { target: { value: '3' } });
  fireEvent.click(screen.getByLabelText('I confirm this fictional receipt belongs to this disposable test account.'));
}
test('separate linking permission sends only explicit IDs, pending revision and test confirmation then rereads', async () => {
  call.mockResolvedValue(linkState()); render(show()); await fillLink();
  expect(screen.queryByText('Record fictional external dues')).not.toBeInTheDocument();
  call.mockResolvedValue(linkState({ dues: [{ ...linkReceipt, linked: true }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Link and activate test membership' }));
  await screen.findByText('Action confirmed. Current server status is shown.');
  expect(call.mock.calls[1][1]).toEqual({
 action: 'admin_dues_link', accountUid: 'officer', requestId: '123e4567-e89b-42d3-a456-426614174000', membershipId: linkId, targetUid: 'disposable-member', expectedRevision: 3, associationConfirmed: true, reason: 'synthetic_staging_review'
});
  expect(call.mock.calls[2][1]).toEqual({ action: 'admin_status', accountUid: 'officer' });
  expect(screen.getByRole('button', { name: 'Link and activate test membership' })).toBeDisabled();
  expect(screen.getByText('Linked test term; verify current access on the member page.', { exact: false })).toBeInTheDocument();
});
test('dues recording or approval does not grant linking or show target controls', async () => {
  call.mockResolvedValue(duesState()); render(show()); await screen.findByText('Record fictional external dues');
  expect(screen.queryByLabelText('Disposable account ID')).not.toBeInTheDocument();
});
test('offline link uncertainty hides the target/receipt controls; exact saved retry is reused', async () => {
  call.mockResolvedValue(linkState()); render(show()); await fillLink();
  call.mockRejectedValueOnce(new Error('synthetic offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Link and activate test membership' }));
  await screen.findByText(/Action could not be confirmed/);
  expect(screen.queryByLabelText('Disposable account ID')).not.toBeInTheDocument();
  const request = call.mock.calls[1][1]; fireEvent.click(screen.getByRole('button', { name: 'Retry saved action' }));
  await screen.findByText('Action confirmed. Current server status is shown.');
  expect(call.mock.calls[2][1]).toEqual(request);
});
test('revoked status clears linked receipt and target controls', async () => {
  call.mockResolvedValue(linkState({ dues: [{ ...linkReceipt, linked: true }] })); render(show());
  await screen.findByText(/Linked test term; verify current access/);
  call.mockRejectedValueOnce(new Error('synthetic revoked'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh officer status' }));
  await screen.findByText(/Officer access is unavailable/);
  expect(screen.queryByText(/Linked test term; verify current access/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Disposable account ID')).not.toBeInTheDocument();
});
test('account switch while linking discards obsolete status and saved command without leaking target', async () => {
  call.mockResolvedValue(linkState()); const rendered = render(show()); await fillLink();
  let resolve: (value: any) => void = () => undefined;
  call.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Link and activate test membership' }));
  mockUser = { uid: 'other' };
  call.mockResolvedValue(state({
    capabilities: { membershipApproval: false, freeEventManagement: false }, pending: [],
  }));
  rendered.rerender(show());
  await act(async () => resolve(linkState({ dues: [{ ...linkReceipt, linked: true }] })));
  expect(screen.queryByLabelText('Disposable account ID')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry saved action' })).not.toBeInTheDocument();
  expect(call.mock.calls.filter(([, request]) => request.action === 'admin_dues_link')).toHaveLength(1);
});
test('dues recording sends only confirmation and server policy revision, not price, term or UID association', async () => {
  call.mockResolvedValue(duesState()); render(show());
  const confirmation = await screen.findByLabelText('Fictional confirmation ID (UUID)');
  fireEvent.change(confirmation, { target: { value: '123e4567-e89b-42d3-a456-426614174001' } });
  fireEvent.click(screen.getByLabelText(/I confirm this is a fictional test/));
  fireEvent.click(screen.getByRole('button', { name: 'Record fictional dues' }));
  await screen.findByText('Action confirmed. Current server status is shown.');
  expect(call.mock.calls[1][1]).toEqual({
 action: 'admin_dues_record', accountUid: 'officer', requestId: '123e4567-e89b-42d3-a456-426614174000', expectedRevision: 0, confirmationId: '123e4567-e89b-42d3-a456-426614174001', externalConfirmed: true, policyRevision: 3, reason: 'synthetic_staging_review'
});
});
test('uncertain dues hides records and retry reuses exact confirmation command', async () => {
  call.mockResolvedValue(duesState()); render(show());
  fireEvent.change(await screen.findByLabelText('Fictional confirmation ID (UUID)'), { target: { value: '123e4567-e89b-42d3-a456-426614174001' } });
  fireEvent.click(screen.getByLabelText(/I confirm this is a fictional test/));
  call.mockRejectedValueOnce(new Error('synthetic offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Record fictional dues' }));
  const retry = await screen.findByRole('button', { name: 'Retry saved action' });
  await screen.findByText(/Action could not be confirmed/);
  expect(screen.queryByText('Record fictional external dues')).not.toBeInTheDocument();
  const request = call.mock.calls[1][1]; fireEvent.click(retry);
  await screen.findByText('Action confirmed. Current server status is shown.');
  expect(call.mock.calls[2][1]).toEqual(request);
});
test('dues projection requires its permission and closed policy disables submission', async () => {
  call.mockResolvedValue(duesState({ duesRecordingOpen: false })); render(show());
  expect(await screen.findByRole('button', { name: 'Record fictional dues' })).toBeDisabled();
  expect(screen.queryByText('Pending membership requests')).not.toBeInTheDocument();
});
test('dues pagination sends only the dues cursor', async () => {
  call.mockResolvedValue(duesState({ nextDuesCursor: 'stage_dues_fixture' })); render(show());
  fireEvent.click(await screen.findByRole('button', { name: 'Next dues receipts' }));
  await screen.findByText('Status refreshed.');
  expect(call.mock.calls[1][1]).toEqual({ action: 'admin_status', accountUid: 'officer', duesCursor: 'stage_dues_fixture' });
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
