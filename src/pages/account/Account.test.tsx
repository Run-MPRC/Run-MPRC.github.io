import React from 'react';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Account from './Account';
import {
  getMyProfile, listMyRegistrations, updateMyProfile,
} from '../../services/account/accountService';

jest.mock('../../services/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'runner@example.com', role: 'member' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

jest.mock('../../services/ServiceLocatorContext', () => {
  const services = {
    firebaseResources: { firestore: {}, app: {} },
    identityService: { signOut: jest.fn(), resendVerificationEmail: jest.fn() },
  };
  return {
    useServiceLocator: () => ({
      services,
    }),
  };
});

jest.mock('../../services/account/accountService', () => ({
  getMyProfile: jest.fn(),
  updateMyProfile: jest.fn(),
  listMyRegistrations: jest.fn(),
}));

jest.mock('./StravaSection', () => () => null);

const mockedGetMyProfile = getMyProfile as jest.MockedFunction<typeof getMyProfile>;
const mockedListMyRegistrations = listMyRegistrations as jest.MockedFunction<
  typeof listMyRegistrations
>;
const mockedUpdateMyProfile = updateMyProfile as jest.MockedFunction<typeof updateMyProfile>;

function renderAccount() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/account']}>
        <Account />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedListMyRegistrations.mockResolvedValue({ registrations: [], events: {} });
});

test('replaces provider permission text with a safe retry state', async () => {
  mockedGetMyProfile.mockRejectedValue(
    new Error('Missing or insufficient permissions'),
  );
  mockedListMyRegistrations.mockRejectedValue(
    new Error('Missing or insufficient permissions'),
  );

  renderAccount();

  expect(await screen.findByText('Account details are unavailable')).toBeInTheDocument();
  expect(screen.getByText(/could not load your registrations/i)).toBeInTheDocument();
  expect(screen.queryByText(/missing or insufficient permissions/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
});

test('only enables profile saving after a field changes', async () => {
  const profile: any = {
    uid: 'user-1',
    email: 'runner@example.com',
    fullName: 'Runner One',
    phoneNumber: '',
    role: 'member',
    emailVerified: true,
    provider: 'password',
    createdAt: null,
    lastLogin: null,
  };
  mockedGetMyProfile.mockResolvedValue(profile);
  mockedUpdateMyProfile.mockResolvedValue();

  renderAccount();
  fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }));

  const save = screen.getByRole('button', { name: /save changes/i });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/phone number/i), {
    target: { value: '650-555-0100' },
  });
  expect(save).toBeEnabled();
  fireEvent.click(save);

  await waitFor(() => {
    expect(mockedUpdateMyProfile).toHaveBeenCalledWith(
      {},
      'user-1',
      { fullName: 'Runner One', phoneNumber: '650-555-0100' },
    );
  });
});
