import React from 'react';
import {
 act, fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import FictionalRaces from './FictionalRaces';
import { readFictionalStatus, sendFictionalCommand } from '../../services/community/fictionalRaceService';
import {
 state, uid, recipient, entryId
} from '../../services/community/testSupport/fictionalRaceFixtures';

let mockUser: any;
let mockServices: any;
let mockSessionCallback: (user: any) => void;
let mockSession: any;
const mockSignOut = jest.fn();
let mockCommunityEnabled = true;
jest.mock('firebase/auth', () => ({
  onIdTokenChanged: (auth: any, callback: (user: any) => void) => {
    mockSessionCallback = callback;
    callback(auth.currentUser);
    return jest.fn();
  }
}));
jest.mock('../../services/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    signOut: mockSignOut
  })
}));
jest.mock('../../services/ServiceLocatorContext', () => ({
  useServiceLocator: () => ({
    services: mockServices
  })
}));
jest.mock('../../services/community/communityService', () => ({
  get COMMUNITY_ENABLED() { return mockCommunityEnabled; }
}));
jest.mock('../../services/community/fictionalRaceService', () => ({
  ...jest.requireActual('../../services/community/fictionalRaceService'),
  readFictionalStatus: jest.fn(),
  sendFictionalCommand: jest.fn()
}));
const read = readFictionalStatus as jest.Mock;
const send = sendFictionalCommand as jest.Mock;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const show = () => (
  <HelmetProvider>
    <MemoryRouter future={{
    v7_startTransition: true,
    v7_relativeSplatPath: true
  }}
    >
      <FictionalRaces />
    </MemoryRouter>
  </HelmetProvider>
);
beforeEach(() => {
  jest.clearAllMocks();
  mockCommunityEnabled = true;
  mockUser = {
    uid
  };
  mockSession = {
    uid,
    emailVerified: true
  };
  const app = {
    options: {
      projectId: 'run-mprc-staging'
    }
  };
  mockServices = {
    firebaseResources: {
      auth: {
        app,
        tenantId: null,
        currentUser: mockSession
      },
      functions: {
        app
      }
    }
  };
  read.mockResolvedValue(state());
  send.mockResolvedValue({});
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => '123e4567-e89b-42d3-a456-426614174000'
    }
  });
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); else Reflect.deleteProperty(globalThis, 'crypto');
});
async function ready(kind: Parameters<typeof state>[0] = 'none') {
  read.mockResolvedValue(state(kind));
  render(show());
  await screen.findByText(/Your enrollment:/);
}
test('signed-out and production screens never call backend', () => {
  mockUser = null;
  mockServices.firebaseResources.auth.currentUser = null;
  const view = render(show());
  expect(screen.getByRole('link', {
    name: 'Sign in to continue'
  })).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
  mockUser = {
    uid
  };
  mockServices.firebaseResources.functions.app.options.projectId = 'production';
  view.rerender(show());
  expect(screen.getByText('Fictional races are unavailable here')).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});
test('unverified or mismatched native session hides mutations and makes no read', () => {
  mockSession.emailVerified = false;
  const view = render(show());
  expect(read).not.toHaveBeenCalled();
  mockSession.emailVerified = true;
  mockUser = {
    uid: recipient
  };
  view.rerender(show());
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', {
    name: 'Join fictional race'
  })).not.toBeInTheDocument();
});
test.each(['split-app', 'tenant', 'feature-off'])('disabled %s screen never calls backend', (kind) => {
  if (kind === 'split-app') {
    mockServices.firebaseResources.auth.app = { ...mockServices.firebaseResources.functions.app };
  } else if (kind === 'tenant') mockServices.firebaseResources.auth.tenantId = 'other-tenant';
  else mockCommunityEnabled = false;
  render(show());
  expect(screen.getByText('Fictional races are unavailable here')).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
test('UUID generation failure sends no command and preserves the current screen', async () => {
  await ready('confirmed');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => { throw new Error('synthetic unsupported operation'); } }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel and simulate full credit return' }));
  await screen.findByText(/up-to-date browser/);
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText('Your enrollment: confirmed.')).toBeInTheDocument();
});
test('account switch hides old private entry and rejects its late read', async () => {
  let resolve!: (value: unknown) => void;
  read.mockReturnValueOnce(new Promise((value) => { resolve = value; }));
  const view = render(show());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  mockUser = { uid: recipient };
  mockSession = { uid: recipient, emailVerified: true };
  mockServices.firebaseResources.auth.currentUser = mockSession;
  read.mockResolvedValue(state());
  act(() => mockSessionCallback(mockSession));
  view.rerender(show());
  await screen.findByRole('button', { name: 'Join fictional race' });
  await act(async () => resolve(state('confirmed')));
  expect(screen.queryByText(entryId)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel and simulate full credit return' })).not.toBeInTheDocument();
  expect(read).toHaveBeenLastCalledWith(
    mockServices.firebaseResources.functions,
    mockServices.firebaseResources.auth,
    recipient,
    null
  );
});
test('read failure after permission loss removes all previous private entry controls', async () => {
  await ready('confirmed');
  read.mockRejectedValueOnce(Error('synthetic revoked permission'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh test status' }));
  await screen.findByText(/Fictional race status is unavailable/);
  expect(screen.queryByText(entryId)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Private disposable recipient ID')).not.toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
});
test('join requires fictional waiver, uses only server IDs/revisions and rereads current status', async () => {
  await ready();
  const join = screen.getByRole('button', {
    name: 'Join fictional race'
  });
  expect(join).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', {
    name: 'I accept the fictional test waiver.'
  }));
  read.mockResolvedValue(state('confirmed'));
  fireEvent.click(join);
  await screen.findByText('Your enrollment: confirmed.');
  expect(send).toHaveBeenCalledWith(
    mockServices.firebaseResources.functions,
    mockServices.firebaseResources.auth,
    {
    action: 'race_join',
    accountUid: uid,
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    eventId: 'stage_race_test_race',
    entryId: 'stage_race_new_entry',
    expectedEventRevision: 1,
    expectedEntryRevision: 0,
    waiverAccepted: true,
    waiverVersion: 'fictional-race-waiver-v1'
    }
  );
  expect(read).toHaveBeenLastCalledWith(
    mockServices.firebaseResources.functions,
    mockServices.firebaseResources.auth,
    uid,
    null
  );
});
test('cancel simulates full credit return, then hides terminal/rejoin controls', async () => {
  await ready('confirmed');
  read.mockResolvedValue(state('cancelled'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Cancel and simulate full credit return'
  }));
  await screen.findByText('Your enrollment: cancelled.');
  expect(send.mock.calls[0][2]).toMatchObject({
    action: 'race_cancel',
    expectedEntryRevision: 1
  });
  expect(screen.getByText(/Returned: 10.00 fictional USD credit/)).toBeInTheDocument();
  expect(screen.queryByRole('button', {
    name: 'Join fictional race'
  })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {
    name: 'Cancel and simulate full credit return'
  })).not.toBeInTheDocument();
});
test('private offer and projected owner revoke need no directory or recipient profile', async () => {
  await ready('confirmed');
  const input = screen.getByLabelText('Private disposable recipient ID');
  fireEvent.change(input, {
    target: {
      value: 'real@example.com'
    }
  });
  expect(screen.getByRole('button', {
    name: 'Offer fictional bib transfer'
  })).toBeDisabled();
  fireEvent.change(input, {
    target: {
      value: recipient
    }
  });
  read.mockResolvedValue(state('offered'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Offer fictional bib transfer'
  }));
  await screen.findByRole('button', {
    name: 'Revoke fictional offer'
  });
  expect(send.mock.calls[0][2]).toMatchObject({
    action: 'race_offer',
    recipientUid: recipient,
    expectedEntryRevision: 1
  });
  expect(send.mock.calls[0][2]).not.toHaveProperty('expiresAtMs');
  expect(screen.queryByLabelText('Private disposable recipient ID')).not.toBeInTheDocument();
  read.mockResolvedValue(state('confirmed'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Revoke fictional offer'
  }));
  await screen.findByRole('button', {
    name: 'Cancel and simulate full credit return'
  });
  expect(send.mock.calls[1][2]).toMatchObject({
    action: 'race_revoke',
    expectedEntryRevision: 2
  });
});
test('exact incoming offer + recipient waiver; acceptance rereads own status without consumed offer ID', async () => {
  mockUser = {
    uid: recipient
  };
  mockSession.uid = recipient;
  await ready();
  fireEvent.change(screen.getByLabelText('Private incoming test entry ID'), {
    target: {
      value: entryId
    }
  });
  read.mockResolvedValue(state('incoming'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Check named offer'
  }));
  const accept = await screen.findByRole('button', {
    name: 'Accept fictional bib transfer'
  });
  expect(accept).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', {
    name: "I accept the recipient's fictional test waiver."
  }));
  const accepted = state('confirmed');
  accepted.events[0].entry!.isOriginalCreditOwner = false;
  accepted.events[0].entry!.transferCount = 1;
  accepted.events[0].entry!.canOffer = false;
  read.mockResolvedValue(accepted);
  fireEvent.click(accept);
  await screen.findByText(/Your enrollment: confirmed/);
  expect(send.mock.calls[0][2]).toMatchObject({
    action: 'race_accept',
    accountUid: recipient,
    entryId,
    expectedEntryRevision: 2,
    waiverAccepted: true
  });
  expect(read).toHaveBeenLastCalledWith(
    mockServices.firebaseResources.functions,
    mockServices.firebaseResources.auth,
    recipient,
    null
  );
  expect(screen.queryByRole('button', {
    name: 'Accept fictional bib transfer'
  })).not.toBeInTheDocument();
  expect(screen.getByText(/credit return stays with the original owner/)).toBeInTheDocument();
});
test('lost acknowledgement hides old status and retries identical immutable command before fresh read', async () => {
  await ready('confirmed');
  send.mockRejectedValueOnce(Error('synthetic lost response'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Cancel and simulate full credit return'
  }));
  const retry = await screen.findByRole('button', {
    name: 'Retry saved action'
  });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(screen.queryByText(/Your enrollment:/)).not.toBeInTheDocument();
  const saved = send.mock.calls[0][2];
  send.mockResolvedValue({});
  read.mockResolvedValue(state('cancelled'));
  fireEvent.click(retry);
  await screen.findByText(/Your enrollment: cancelled/);
  expect(send.mock.calls[1][2]).toEqual(saved);
  expect(screen.queryByRole('button', {
    name: 'Retry saved action'
  })).not.toBeInTheDocument();
});
test('successful mutation followed by failed status keeps exact retry; manual refresh clears it only on success', async () => {
  await ready('confirmed');
  read.mockRejectedValueOnce(Error('synthetic malformed/failed response'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Cancel and simulate full credit return'
  }));
  await screen.findByRole('button', {
    name: 'Retry saved action'
  });
  expect(screen.queryByText(/Your enrollment:/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Refresh test status'
  })).toBeEnabled());
  read.mockResolvedValue(state('cancelled'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Refresh test status'
  }));
  await screen.findByText(/Your enrollment: cancelled/);
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', {
    name: 'Retry saved action'
  })).not.toBeInTheDocument();
});
test('failed incoming lookup clears old controls, preserves typed focus and allows explicit own-only recovery', async () => {
  await ready('confirmed');
  fireEvent.change(screen.getByLabelText('Private incoming test entry ID'), {
    target: {
      value: entryId
    }
  });
  read.mockRejectedValueOnce(Error('synthetic denial'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Check named offer'
  }));
  await screen.findByText(/Fictional race status is unavailable/);
  expect(screen.getByLabelText('Private incoming test entry ID')).toHaveValue(entryId);
  expect(screen.queryByText(/Your enrollment:/)).not.toBeInTheDocument();
  read.mockResolvedValue(state('confirmed'));
  fireEvent.click(screen.getByRole('button', {
    name: 'Show only my entries'
  }));
  await screen.findByText(/Your enrollment: confirmed/);
  expect(screen.getByLabelText('Private incoming test entry ID')).toHaveValue('');
});
test('refresh after a failed new offer lookup keeps the selected ID, never the previous offer', async () => {
  mockUser = { uid: recipient };
  mockSession.uid = recipient;
  await ready();
  fireEvent.change(screen.getByLabelText('Private incoming test entry ID'), {
    target: { value: entryId }
  });
  read.mockResolvedValue(state('incoming'));
  fireEvent.click(screen.getByRole('button', { name: 'Check named offer' }));
  await screen.findByRole('button', { name: 'Accept fictional bib transfer' });
  const selected = 'stage_race_other_incoming';
  fireEvent.change(screen.getByLabelText('Private incoming test entry ID'), {
    target: { value: selected }
  });
  read.mockRejectedValueOnce(Error('synthetic new offer unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Check named offer' }));
  await screen.findByText(/Fictional race status is unavailable/);
  expect(screen.getByLabelText('Private incoming test entry ID')).toHaveValue(selected);
  const fresh = state('incoming');
  fresh.incoming!.entryId = selected;
  read.mockResolvedValue(fresh);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh test status' }));
  await screen.findByRole('button', { name: 'Accept fictional bib transfer' });
  expect(read).toHaveBeenLastCalledWith(
    mockServices.firebaseResources.functions,
    mockServices.firebaseResources.auth,
    recipient,
    selected
  );
  expect(send).not.toHaveBeenCalled();
});
test('native same-UID token/session renewal fences late action and never schedules an old-context reread', async () => {
  await ready('confirmed');
  let resolve!: (value: unknown) => void;
  send.mockReturnValueOnce(new Promise((value) => {
    resolve = value;
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Cancel and simulate full credit return'
  }));
  read.mockResolvedValue(state());
  act(() => mockSessionCallback(mockSession));
  await screen.findByRole('button', {
    name: 'Join fictional race'
  });
  const count = read.mock.calls.length;
  await act(async () => resolve({}));
  expect(read).toHaveBeenCalledTimes(count);
  expect(screen.queryByRole('button', {
    name: 'Retry saved action'
  })).not.toBeInTheDocument();
});
test('provider swap cannot display late previous read or reuse saved action', async () => {
  let resolve!: (value: unknown) => void;
  read.mockReturnValueOnce(new Promise((value) => {
    resolve = value;
  }));
  const view = render(show());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  mockServices = {
    ...mockServices
  };
  read.mockResolvedValue(state());
  view.rerender(show());
  await screen.findByRole('button', {
    name: 'Join fictional race'
  });
  await act(async () => resolve(state('confirmed')));
  expect(screen.queryByRole('button', {
    name: 'Cancel and simulate full credit return'
  })).not.toBeInTheDocument();
});
test('known server deadline clears status without polling; no UUID support sends nothing', async () => {
  jest.useFakeTimers();
  await ready();
  fireEvent.click(screen.getByRole('checkbox', {
    name: 'I accept the fictional test waiver.'
  }));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {}
  });
  fireEvent.click(screen.getByRole('button', {
    name: 'Join fictional race'
  }));
  await screen.findByText(/up-to-date browser/);
  expect(send).not.toHaveBeenCalled();
  const count = read.mock.calls.length;
  act(() => jest.advanceTimersByTime(10001));
  expect(screen.queryByText(/Your enrollment:/)).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(count);
});
test('cancelled event preserves own confirmed history and cancellation, not new signup or transfer', async () => {
  const cancelledEvent = state('confirmed');
  cancelledEvent.events[0].signupStatus = 'cancelled';
  cancelledEvent.events[0].entry!.canOffer = false;
  read.mockResolvedValue(cancelledEvent);
  render(show());
  await screen.findByText('Your enrollment: confirmed.');
  expect(screen.getByText(/Signup: cancelled/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel and simulate full credit return' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Join fictional race' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Offer fictional bib transfer' })).not.toBeInTheDocument();
});
