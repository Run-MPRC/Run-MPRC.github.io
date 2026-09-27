import React from 'react';
import {
  act, fireEvent, render, screen, waitFor, within
} from '@testing-library/react';
import {
  MemoryRouter, Route, Routes, useLocation
} from 'react-router-dom';
import { useAuth } from '../../services/hooks/useAuth';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import * as service from '../../services/account/runnerConnectionService';
import {
  readProfile,
  previewCard,
  ProfileState,
} from '../../services/account/runnerConnectionContract';
import RunnerConnections, { RunnerWorkspace } from './RunnerConnections';
import RunnerProfileForm from './RunnerProfileForm';

const { profile } = require('../../../functions/testSupport/runnerConnectionsFixtures');

jest.mock('../../components/SEO', () => () => null);
jest.mock('../../services/hooks/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/ServiceLocatorContext', () => ({ useServiceLocator: jest.fn() }));
jest.mock('../../services/account/runnerConnectionService', () => ({
  __esModule: true,
  ...jest.requireActual('../../services/account/runnerConnectionService'),
  createRunnerClient: jest.fn(),
  createRunnerRequestId: jest.fn(),
  RUNNER_CONNECTIONS_AVAILABLE: false,
}));
const EMPTY: ProfileState = {
  schemaVersion: 1,
  consentVersion: 1,
  revision: 0,
  adultConfirmed: false,
  profile: null,
  consent: { memberDiscovery: false, similarity: false, broadenCircle: false },
};
const saved = (): ProfileState => ({
  ...EMPTY,
  revision: 1,
  adultConfirmed: true,
  profile: readProfile(profile()),
  consent: { memberDiscovery: true, similarity: true, broadenCircle: true },
});
const ref = `runner_${'a'.repeat(64)}`;
const suggestions = () => ({
  rankerVersion: 1 as const,
  status: 'ready' as const,
  windowEndsAtMs: Date.now() + 3600000,
  similar: [
    {
      ...previewCard(profile({ displayName: 'Synthetic Partner' })),
      entryRef: ref,
      reasons: ['pace_overlap'],
    },
  ],
  broaden: [],
});
const client = () => ({
  read: jest.fn().mockResolvedValue(saved()),
  save: jest
    .fn()
    .mockImplementation(async (request) => ({
      ...saved(),
      ...request,
      schemaVersion: 1,
      revision: request.expectedRevision + 1,
    })),
  withdraw: jest.fn().mockResolvedValue({ ...EMPTY, revision: 2 }),
  recommend: jest.fn().mockImplementation(async () => suggestions()),
  exclusion: jest.fn().mockResolvedValue({ revision: 0, hidden: false, blocked: false }),
  exclude: jest
    .fn()
    .mockImplementation(async (request) => ({
      revision: request.expectedRevision + 1,
      hidden: request.hidden,
      blocked: request.blocked,
    })),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function fillNew() {
  change('Display name', 'Synthetic New Runner');
  change('Faster easy pace (m:ss)', '8:00');
  change('Slower easy pace (m:ss)', '10:00');
  change('Shortest run (km)', '4');
  change('Longest run (km)', '10');
  ['Bay Trail', 'Road', 'Continuous running', 'Build consistency'].forEach((name) => fireEvent.click(screen.getByRole('checkbox', { name })),);
  change('Your running experience', 'beginner');
}
beforeEach(() => {
  jest.clearAllMocks();
  (service as any).RUNNER_CONNECTIONS_AVAILABLE = false;
  (service.createRunnerRequestId as jest.Mock).mockReturnValue(
    '00000000-0000-4000-8000-000000000001',
  );
  (useAuth as jest.Mock).mockReturnValue({
    user: { uid: 'synthetic-one', role: 'unverified' },
    isLoading: false,
  });
  (useServiceLocator as jest.Mock).mockReturnValue({
    isReady: true,
    services: { firebaseResources: { app: { name: 'synthetic-app' } } },
  });
});
test('disabled direct route never starts private work, regardless of URL flags', () => {
  render(
    <MemoryRouter initialEntries={['/account/running-partners?enabled=true']}>
      <RunnerConnections />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Not available yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Public club runs' })).toHaveAttribute(
    'href',
    '/activities',
  );
  expect(service.createRunnerClient).not.toHaveBeenCalled();
  expect(useAuth).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('new card starts with all sharing and age choices off and requires an exact preview', () => {
  const save = jest.fn();
  render(<RunnerProfileForm initial={EMPTY} disabled={false} onSave={save} />);
  expect(screen.getByLabelText('I confirm I am 18 or older')).not.toBeChecked();
  expect(screen.getByLabelText(/Let participating/)).not.toBeChecked();
  expect(screen.getByLabelText(/similar-runner suggestions/)).not.toBeChecked();
  expect(screen.getByLabelText(/Broaden my circle/)).not.toBeChecked();
  expect(screen.queryByRole('button', { name: /Save.*card/ })).not.toBeInTheDocument();
  fillNew();
  fireEvent.click(screen.getByRole('button', { name: 'Preview my card' }));
  const preview = screen.getByRole('region', { name: 'Exact runner card preview' });
  expect(
    within(preview).getByRole('heading', { name: 'Synthetic New Runner' }),
  ).toBeInTheDocument();
  expect(within(preview).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save private card' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('I confirm I am 18 or older'));
  fireEvent.click(screen.getByRole('button', { name: 'Save private card' }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ displayName: 'Synthetic New Runner' }),
    EMPTY.consent,
  );
});
test('editing invalidates a preview; unit changes clear both entered paces', () => {
  render(<RunnerProfileForm initial={saved()} disabled={false} onSave={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview my card' }));
  change('Display name', 'Changed synthetic');
  expect(
    screen.queryByRole('region', { name: 'Exact runner card preview' }),
  ).not.toBeInTheDocument();
  change('Pace unit', 'min/mile');
  expect(screen.getByLabelText('Faster easy pace (m:ss)')).toHaveValue('');
  expect(screen.getByLabelText('Slower easy pace (m:ss)')).toHaveValue('');
});
test('turning discovery off clears both recommendation permissions; re-enabling does not recheck them', () => {
  render(<RunnerProfileForm initial={saved()} disabled={false} onSave={jest.fn()} />);
  fireEvent.click(screen.getByLabelText(/Let participating/));
  expect(screen.getByLabelText(/similar-runner suggestions/)).not.toBeChecked();
  expect(screen.getByLabelText(/Broaden my circle/)).not.toBeChecked();
  fireEvent.click(screen.getByLabelText(/Let participating/));
  expect(screen.getByLabelText(/similar-runner suggestions/)).not.toBeChecked();
});
test('overlapping windows and reversed pace reject preview without calling save', () => {
  const save = jest.fn();
  render(<RunnerProfileForm initial={saved()} disabled={false} onSave={save} />);
  change('Faster easy pace (m:ss)', '10:00');
  change('Slower easy pace (m:ss)', '5:00');
  fireEvent.click(screen.getByRole('button', { name: 'Preview my card' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/Review your name/);
  expect(
    screen.queryByRole('button', { name: 'Save and share my card' }),
  ).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  change('Faster easy pace (m:ss)', '5:00');
  change('Slower easy pace (m:ss)', '10:00');
  fireEvent.click(screen.getByRole('button', { name: 'Add time window' }));
  change('Day 2', '6');
  fireEvent.click(screen.getByRole('button', { name: 'Preview my card' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/Review your name/);
  expect(screen.queryByRole('region', { name: 'Exact runner card preview' })).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
test('midnight availability survives editing without silent truncation', () => {
  const initial = saved();
  initial.profile!.availability[0].endMinute = 1440;
  render(<RunnerProfileForm initial={initial} disabled={false} onSave={jest.fn()} />);
  expect(screen.getByLabelText(/End/)).toHaveValue('1440');
  fireEvent.click(screen.getByRole('button', { name: 'Preview my card' }));
  expect(screen.getByRole('region', { name: 'Exact runner card preview' })).toHaveTextContent(
    '24:00',
  );
});
test('withdrawal resets card, adult confirmation and discovery rather than silently reenrolling', async () => {
  const api = client();
  render(<RunnerWorkspace client={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove my runner card' }));
  await waitFor(() => expect(screen.getByLabelText('I confirm I am 18 or older')).not.toBeChecked(),);
  expect(screen.getByLabelText(/Let participating/)).not.toBeChecked();
  expect(screen.getByLabelText('Display name')).toHaveValue('');
  expect(api.withdraw).toHaveBeenCalledWith({
    requestId: '00000000-0000-4000-8000-000000000001',
    expectedRevision: 1,
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Your card and sharing choices were removed',
  );
});
test('uncertain save blocks edits and retries exactly the original request, without false success', async () => {
  const api = client();
  api.save.mockRejectedValueOnce(new Error('synthetic-private-provider-detail'));
  render(<RunnerWorkspace client={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preview my card' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save and share my card' }));
  const retry = await screen.findByRole('button', { name: 'Retry the same change' });
  expect(screen.getByLabelText('Display name')).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('could not confirm whether');
  expect(screen.queryByText('synthetic-private-provider-detail')).not.toBeInTheDocument();
  fireEvent.click(retry);
  await screen.findByText('Your runner card was saved with discovery on.');
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1][0]).toBe(api.save.mock.calls[0][0]);
  expect(service.createRunnerRequestId).toHaveBeenCalledTimes(1);
});
test('definitive conflict offers a fresh read, not a success or an automatic overwrite', async () => {
  const api = client();
  api.withdraw.mockRejectedValue({ code: 'functions/aborted' });
  render(<RunnerWorkspace client={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove my runner card' }));
  await screen.findByRole('button', { name: 'Reload runner settings' });
  expect(
    screen.queryByText(/Your card and sharing choices were removed/),
  ).not.toBeInTheDocument();
  expect(api.withdraw).toHaveBeenCalledTimes(1);
});
test('read failure has no fallback profile, fictitious members or success message', async () => {
  const api = client();
  api.read.mockRejectedValue(new Error('synthetic-private'));
  render(<RunnerWorkspace client={api} />);
  await screen.findByRole('button', { name: 'Reload runner settings' });
  expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
  expect(api.recommend).not.toHaveBeenCalled();
});
test('sparse results describe a limited daily selection, and an outage clears old cards', async () => {
  const api = client();
  render(<RunnerWorkspace client={api} />);
  const check = await screen.findByRole('button', { name: 'Check today’s suggestions' });
  fireEvent.click(check);
  await screen.findByRole('heading', { name: 'Synthetic Partner' });
  api.recommend.mockRejectedValueOnce(new Error('synthetic-private'));
  fireEvent.click(check);
  await screen.findByText(/Suggestions are unavailable/);
  expect(screen.queryByRole('heading', { name: 'Synthetic Partner' })).not.toBeInTheDocument();
  api.recommend.mockResolvedValueOnce({ ...suggestions(), similar: [] });
  fireEvent.click(check);
  await screen.findByText(/No matches in today’s selection/);
});
test('hiding uses the current exclusion revision and does not request replacement cards', async () => {
  const api = client();
  api.exclusion.mockResolvedValue({ revision: 2, hidden: false, blocked: true });
  render(<RunnerWorkspace client={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check today’s suggestions' }));
  fireEvent.click(await screen.findByRole('button', { name: /Hide.*Synthetic Partner/ }));
  await screen.findByText(/Your privacy choice was saved/);
  expect(api.exclude).toHaveBeenCalledWith(
    expect.objectContaining({
      entryRef: ref,
      expectedRevision: 2,
      hidden: true,
      blocked: true,
    }),
  );
  expect(api.recommend).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: 'Synthetic Partner' })).not.toBeInTheDocument();
});
test('blur clears displayed suggestions and prevents an in-flight reply from repopulating them', async () => {
  const api = client();
  const pending = deferred<any>();
  api.recommend.mockReturnValueOnce(pending.promise);
  render(<RunnerWorkspace client={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check today’s suggestions' }));
  fireEvent.blur(window);
  await act(async () => {
    pending.resolve(suggestions());
  });
  expect(screen.queryByRole('heading', { name: 'Synthetic Partner' })).not.toBeInTheDocument();
});
test('unmounted work cannot disclose an old profile into another mounted workspace', async () => {
  const old = client();
  const pending = deferred<ProfileState>();
  old.read.mockReturnValue(pending.promise);
  const rendered = render(<RunnerWorkspace key="old" client={old} />);
  const fresh = client();
  fresh.read.mockResolvedValue(EMPTY);
  rendered.rerender(<RunnerWorkspace key="new" client={fresh} />);
  await screen.findByLabelText('Display name');
  await act(async () => {
    pending.resolve(saved());
  });
  expect(screen.getByLabelText('Display name')).toHaveValue('');
});
test('enabled route requires sign-in and preserves its intended return path', () => {
  function LoginProbe() {
    const location = useLocation();
    return <p>{`Login screen ${location.state?.from}`}</p>;
  }
  (service as any).RUNNER_CONNECTIONS_AVAILABLE = true;
  (useAuth as jest.Mock).mockReturnValue({ user: null, isLoading: false });
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<RunnerConnections />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText(/Login screen/)).toHaveTextContent(
    'Login screen /account/running-partners',
  );
  expect(service.createRunnerClient).not.toHaveBeenCalled();
});
test('source route discards private state when either UID or Firebase app changes', async () => {
  (service as any).RUNNER_CONNECTIONS_AVAILABLE = true;
  const first = client();
  const second = client();
  second.read.mockResolvedValue(EMPTY);
  (service.createRunnerClient as jest.Mock).mockReturnValueOnce(first).mockReturnValue(second);
  const rendered = render(
    <MemoryRouter>
      <RunnerConnections />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('Synthetic Runner'),);
  (useAuth as jest.Mock).mockReturnValue({
    user: { uid: 'synthetic-two', role: 'admin' },
    isLoading: false,
  });
  rendered.rerender(
    <MemoryRouter>
      <RunnerConnections />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue(''));
  change('Display name', 'Unsent synthetic draft');
  (useServiceLocator as jest.Mock).mockReturnValue({
    isReady: true,
    services: { firebaseResources: { app: { name: 'same-name-different-object' } } },
  });
  rendered.rerender(
    <MemoryRouter>
      <RunnerConnections />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue(''));
  expect(service.createRunnerClient).toHaveBeenCalledTimes(3);
});
