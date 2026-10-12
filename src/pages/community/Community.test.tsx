import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import {
 act, fireEvent, render, screen, waitFor
} from '@testing-library/react';
import Community from './Community';
import { callCommunity } from '../../services/community/communityService';

let mockUser: any = { uid: 'runner-a' };
const mockFunctions = { app: { options: { projectId: 'run-mprc-staging' } } };
const mockAuth = { currentUser: { emailVerified: true } };
jest.mock('../../services/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser, isLoading: false }) }));
jest.mock('../../services/ServiceLocatorContext', () => ({ useServiceLocator: () => ({ services: { firebaseResources: { functions: mockFunctions, auth: mockAuth } } }) }));
jest.mock('../../services/community/communityService', () => ({ COMMUNITY_ENABLED: true, callCommunity: jest.fn() }));
const call = callCommunity as jest.Mock;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});
const state = (applicationStatus = 'none', revision = 0) => ({
  membership: {
 applicationStatus, revision, entitlement: 'not_entitled', accessThroughMs: null
},
events: [],
});
const show = () => (
  <HelmetProvider>
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Community />
    </MemoryRouter>
  </HelmetProvider>
);
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { uid: 'runner-a' }; mockAuth.currentUser.emailVerified = true;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' } });
  call.mockResolvedValue(state());
});
test('signed-out page makes no backend call', () => {
  mockUser = null; render(show());
  expect(screen.getByRole('link', { name: 'Sign in to continue' })).toBeInTheDocument();
  expect(call).not.toHaveBeenCalled();
});
test('signed-out staging notice stays visible and sign-in returns to community', () => {
  mockUser = null;
  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="return-path">{`${location.pathname}:${location.state?.from || ''}`}</output>;
  }
  render(
    <HelmetProvider>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Community />
        <LocationProbe />
      </MemoryRouter>
    </HelmetProvider>,
  );
  expect(screen.getByRole('note')).toHaveTextContent('Staging test only');
  fireEvent.click(screen.getByRole('link', { name: 'Sign in to continue' }));
  expect(screen.getByTestId('return-path')).toHaveTextContent('/login:/community');
  expect(call).not.toHaveBeenCalled();
});
test('pending membership request uses the signed-in account and rereads status', async () => {
  render(show()); await screen.findByRole('button', { name: 'Request membership' });
  call.mockResolvedValueOnce({ membership: { revision: 1, applicationStatus: 'pending' } }).mockResolvedValueOnce(state('pending', 1));
  fireEvent.click(screen.getByRole('button', { name: 'Request membership' }));
  await screen.findByText('Request status: pending.');
  expect(call).toHaveBeenNthCalledWith(2, mockFunctions, {
 action: 'membership_join', accountUid: 'runner-a', expectedRevision: 0, requestId: '123e4567-e89b-42d3-a456-426614174000'
});
  expect(call).toHaveBeenNthCalledWith(3, mockFunctions, { action: 'status', accountUid: 'runner-a' });
});
test('an uncertain request retries exactly once with the original ID, then rereads', async () => {
  render(show()); await screen.findByRole('button', { name: 'Request membership' });
  call.mockRejectedValueOnce(new Error('synthetic timeout'));
  fireEvent.click(screen.getByRole('button', { name: 'Request membership' }));
  await screen.findByRole('button', { name: 'Retry request' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry request' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Request membership' })).toBeDisabled();
  const original = call.mock.calls[1][1];
  call.mockResolvedValueOnce({ membership: { revision: 1, applicationStatus: 'pending' } }).mockResolvedValueOnce(state('pending', 1));
  fireEvent.click(screen.getByRole('button', { name: 'Retry request' }));
  await screen.findByText('Request status: pending.');
  expect(call.mock.calls[2][1]).toEqual(original);
});
test('refresh can recover from a stale or denied command without sending it again', async () => {
  render(show()); await screen.findByRole('button', { name: 'Request membership' });
  call.mockRejectedValueOnce(new Error('synthetic conflict'));
  fireEvent.click(screen.getByRole('button', { name: 'Request membership' }));
  await screen.findByRole('button', { name: 'Retry request' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled());
  call.mockResolvedValueOnce(state('pending', 1));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Request status: pending.');
  expect(call.mock.calls[2][1]).toEqual({ action: 'status', accountUid: 'runner-a' });
  expect(screen.queryByRole('button', { name: 'Retry request' })).not.toBeInTheDocument();
});
test('unverified accounts cannot start a mutation', async () => {
  mockAuth.currentUser.emailVerified = false; render(show());
  await screen.findByRole('button', { name: 'Request membership' });
  expect(screen.getByRole('button', { name: 'Request membership' })).toBeDisabled();
});
test('an obsolete account status completion is ignored', async () => {
  let finish!: (value: unknown) => void;
  call.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(show());
  mockUser = { uid: 'runner-b' }; view.rerender(show());
  await waitFor(() => expect(call).toHaveBeenCalledWith(mockFunctions, { action: 'status', accountUid: 'runner-b' }));
  await act(async () => { finish(state('pending', 99)); });
  expect(screen.queryByText('Request status: pending.')).not.toBeInTheDocument();
});
test('free-event signup and cancellation use server versions and refresh counts', async () => {
  const event = {
    id: 'fixture-event',
title: 'Synthetic event',
location: 'Synthetic place',
    startAtMs: 1800000000000,
opensAtMs: 1,
closesAtMs: 1800000000000,
    status: 'open',
capacity: 1,
confirmedCount: 0,
    waiverText: 'Synthetic waiver only',
waiverVersion: 'synthetic-v1',
    registration: { revision: 0, status: 'none' },
  };
  call.mockResolvedValueOnce({ ...state(), events: [event] });
  render(show());
  await screen.findByRole('button', { name: 'Sign up for Synthetic event' });
  expect(screen.getByRole('button', { name: 'Sign up for Synthetic event' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  call.mockResolvedValueOnce({ registration: { status: 'confirmed', revision: 1 } });
  call.mockResolvedValueOnce({ ...state(), events: [{ ...event, confirmedCount: 1, registration: { status: 'confirmed', revision: 1 } }] });
  fireEvent.click(screen.getByRole('button', { name: 'Sign up for Synthetic event' }));
  await screen.findByRole('button', { name: 'Cancel signup for Synthetic event' });
  expect(call.mock.calls[1][1]).toMatchObject({
 action: 'event_join', eventId: 'fixture-event', expectedRevision: 0, waiverVersion: 'synthetic-v1', waiverAccepted: true
});
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel signup for Synthetic event' })).toBeEnabled());
  call.mockResolvedValueOnce({ registration: { status: 'cancelled', revision: 2 } });
  call.mockResolvedValueOnce({ ...state(), events: [{ ...event, registration: { status: 'cancelled', revision: 2 } }] });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel signup for Synthetic event' }));
  await screen.findByText(/Your signup: cancelled/);
  expect(call.mock.calls[3][1]).toMatchObject({ action: 'event_cancel', expectedRevision: 1 });
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
