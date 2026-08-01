/* eslint-env jest */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import {
  createMemberDirectoryRequestId,
  getMyMemberDirectoryProfile,
  isDefinitiveMemberDirectoryRejection,
  removeMyMemberDirectoryPhoto,
  setMyMemberDirectoryPhoto,
  setMyMemberDirectoryVisibility,
} from '../../services/account/memberDirectoryService';
import MemberDirectoryProfile from './MemberDirectoryProfile';

jest.mock('../../services/account/memberDirectoryService', () => {
  const actual = jest.requireActual('../../services/account/memberDirectoryService');
  return {
    ...actual,
    createMemberDirectoryRequestId: jest.fn(),
    getMyMemberDirectoryProfile: jest.fn(),
    isDefinitiveMemberDirectoryRejection: jest.fn(),
    removeMyMemberDirectoryPhoto: jest.fn(),
    setMyMemberDirectoryPhoto: jest.fn(),
    setMyMemberDirectoryVisibility: jest.fn(),
  };
});

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const app = { name: 'synthetic-app' } as any;
const otherApp = { name: 'other-synthetic-app' } as any;
const PHOTO = {
  contentType: 'image/webp' as const,
  base64Data: btoa('synthetic processed thumbnail'),
  width: 256 as const,
  height: 256 as const,
  version: REQUEST_ID,
};
const DEFAULT_PROFILE = {
  schemaVersion: 1 as const,
  revision: 0,
  searchableByOfficers: false,
  hasPhoto: false,
  photo: null,
};
const PROFILE_WITH_PHOTO = {
  schemaVersion: 1 as const,
  revision: 4,
  searchableByOfficers: true,
  hasPhoto: true,
  photo: PHOTO,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderProfile({
  firebaseApp = app,
  uid = 'synthetic-user',
  hasDisplayName = true,
}: {
  firebaseApp?: typeof app;
  uid?: string;
  hasDisplayName?: boolean;
} = {}) {
  return render(
    <MemberDirectoryProfile
      app={firebaseApp}
      uid={uid}
      hasDisplayName={hasDisplayName}
    />,
  );
}

describe('My Account member directory profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createMemberDirectoryRequestId as jest.Mock).mockReturnValue(REQUEST_ID);
    (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValue(DEFAULT_PROFILE);
    (isDefinitiveMemberDirectoryRejection as jest.Mock).mockReturnValue(false);
    (setMyMemberDirectoryVisibility as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      revision: 1,
      searchableByOfficers: true,
      hasPhoto: false,
    });
    (setMyMemberDirectoryPhoto as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      revision: 1,
      searchableByOfficers: false,
      hasPhoto: true,
    });
    (removeMyMemberDirectoryPhoto as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      revision: 5,
      searchableByOfficers: true,
      hasPhoto: false,
    });
  });

  test('loads missing settings as private by default with separate photo controls', async () => {
    renderProfile();

    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Profile photo and officer finder',
    })).toBeInTheDocument();
    expect(await screen.findByLabelText('No profile photo')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    })).not.toBeChecked();
    expect(screen.getByLabelText('Add profile photo')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
    expect(screen.queryByRole('button', { name: 'Remove profile photo' }))
      .not.toBeInTheDocument();
    expect(screen.getByText(/search result does not prove current club membership/i))
      .toBeInTheDocument();
    expect(screen.getByText(/turning it off removes you from this optional finder/i))
      .toBeInTheDocument();
    expect(screen.getByText(/leaves your private thumbnail stored until you remove it/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not use facial recognition or image matching/i))
      .toBeInTheDocument();
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
  });

  test('uploads a valid image with exact bytes and refetches without changing visibility', async () => {
    const refreshed = {
      ...DEFAULT_PROFILE,
      revision: 1,
      hasPhoto: true,
      photo: PHOTO,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(refreshed);
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    const file = new File(['synthetic pixels'], 'runner.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 0,
      contentType: 'image/png',
      base64Data: btoa('synthetic pixels'),
    }));
    expect(input).toHaveValue('');
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toHaveAttribute('src', `data:image/webp;base64,${PHOTO.base64Data}`);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Profile photo saved. Your officer finder setting did not change.',
    );
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
  });

  test('replaces an existing photo without changing visibility', async () => {
    const replacement = {
      ...PROFILE_WITH_PHOTO,
      revision: 5,
      photo: { ...PHOTO, base64Data: btoa('replacement processed thumbnail') },
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(replacement);
    renderProfile();
    const input = await screen.findByLabelText('Replace profile photo');
    const file = new File(['replacement pixels'], 'replacement.webp', {
      type: 'image/webp',
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 4,
      contentType: 'image/webp',
      base64Data: btoa('replacement pixels'),
    }));
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toHaveAttribute('src', `data:image/webp;base64,${replacement.photo.base64Data}`);
  });

  test.each([
    [
      'unsupported type',
      () => new File(['synthetic'], 'runner.gif', { type: 'image/gif' }),
      /choose a JPG, PNG, or WebP image/i,
    ],
    [
      'oversized image',
      () => new File(
        [new Uint8Array((2 * 1024 * 1024) + 1)],
        'runner.png',
        { type: 'image/png' },
      ),
      /2 MiB or smaller/i,
    ],
    [
      'empty image',
      () => new File([], 'runner.webp', { type: 'image/webp' }),
      /non-empty image/i,
    ],
  ])('rejects an %s before reading or uploading', async (_label, makeFile, message) => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');

    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
  });

  test('turns the finder on separately and refetches the authoritative setting', async () => {
    const searchableProfile = {
      ...DEFAULT_PROFILE,
      revision: 1,
      searchableByOfficers: true,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(searchableProfile);
    renderProfile();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    });

    fireEvent.click(checkbox);

    await waitFor(() => expect(setMyMemberDirectoryVisibility).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 0,
      searchableByOfficers: true,
    }));
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(await screen.findByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Officer finder is on.');
  });

  test('turns the finder off without deleting a stored photo', async () => {
    const hiddenProfile = {
      ...PROFILE_WITH_PHOTO,
      revision: 5,
      searchableByOfficers: false,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(hiddenProfile);
    renderProfile();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    });

    fireEvent.click(checkbox);

    await waitFor(() => expect(setMyMemberDirectoryVisibility).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 4,
      searchableByOfficers: false,
    }));
    expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Officer finder is off.');
  });

  test('announces the refetched visibility when another context changes it again', async () => {
    const changedAgain = {
      ...PROFILE_WITH_PHOTO,
      revision: 6,
      searchableByOfficers: true,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(changedAgain);
    renderProfile();

    fireEvent.click(await screen.findByRole('checkbox'));

    expect(await screen.findByText(
      'Officer finder changed again elsewhere. It is currently on.',
    )).toHaveAttribute('role', 'status');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('status')).not.toHaveTextContent('Officer finder is off.');
  });

  test('requires a saved display name before opt-in while leaving photo upload available', async () => {
    renderProfile({ hasDisplayName: false });

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/add your full name in the Profile section/i))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Add profile photo')).toBeEnabled();
  });

  test('keeps controls available when a secure request ID cannot be created', async () => {
    (createMemberDirectoryRequestId as jest.Mock).mockImplementationOnce(() => {
      throw new Error('synthetic crypto unavailable');
    });
    renderProfile();

    fireEvent.click(await screen.findByRole('checkbox'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not safely start that change/i,
    );
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(screen.getByLabelText('Add profile photo')).toBeEnabled();
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('synthetic crypto unavailable');
  });

  test('keeps an existing opt-in removable but hidden when the display name is cleared', async () => {
    (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValue(PROFILE_WITH_PHOTO);
    renderProfile({ hasDisplayName: false });

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(checkbox.getAttribute('aria-describedby')).toContain(
      'member-directory-name-required',
    );
    expect(screen.getByText(/officers cannot find you until you add a full name/i))
      .toBeInTheDocument();
    expect(screen.getByText(/you can still turn the setting off/i)).toBeInTheDocument();
  });

  test('removes a photo without changing an enabled finder setting', async () => {
    const refreshed = {
      ...PROFILE_WITH_PHOTO,
      revision: 5,
      hasPhoto: false,
      photo: null,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(refreshed);
    renderProfile();
    const remove = await screen.findByRole('button', { name: 'Remove profile photo' });

    fireEvent.click(remove);

    await waitFor(() => expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 4,
    }));
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('No profile photo')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Profile photo removed. Your officer finder setting did not change.',
    );
  });

  test('announces a current photo restored elsewhere after removal', async () => {
    const changedAgain = {
      ...PROFILE_WITH_PHOTO,
      revision: 6,
      photo: { ...PHOTO, version: '22222222-2222-4222-8222-222222222222' },
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(changedAgain);
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove profile photo' }));

    expect(await screen.findByText(
      'Profile photo changed again elsewhere. The preview shows the current photo.',
    )).toHaveAttribute('role', 'status');
    expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('Profile photo removed.');
  });

  test('blocks parallel mutations, then hides all controls after an unknown mutation outcome', async () => {
    const request = deferred<never>();
    (setMyMemberDirectoryVisibility as jest.Mock).mockReturnValueOnce(request.promise);
    renderProfile();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let authorized officers find me by name',
    });

    fireEvent.click(checkbox);

    expect(checkbox).toBeDisabled();
    expect(screen.getByLabelText('Add profile photo')).toBeDisabled();
    fireEvent.click(checkbox);
    expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);

    const hostileFailure = new Proxy({}, {
      get() {
        throw new Error('synthetic-provider-canary');
      },
    });
    await act(async () => request.reject(hostileFailure));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not confirm that change/i,
    );
    expect(document.body).not.toHaveTextContent('synthetic-provider-canary');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add profile photo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Replace profile photo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload settings' })).toBeInTheDocument();
  });

  test('refetches and keeps controls available after a definitive server rejection', async () => {
    const rejected = { code: 'functions/invalid-argument' };
    (setMyMemberDirectoryVisibility as jest.Mock).mockRejectedValueOnce(rejected);
    (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
      (error) => error === rejected,
    );
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(DEFAULT_PROFILE);
    renderProfile();

    fireEvent.click(await screen.findByRole('checkbox'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /rejected before it was saved/i,
    );
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(screen.getByLabelText('Add profile photo')).toBeEnabled();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
  });

  test('reloads settings before allowing a retry after an unknown outcome', async () => {
    const current = { ...DEFAULT_PROFILE, revision: 1, searchableByOfficers: true };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(current);
    (setMyMemberDirectoryVisibility as jest.Mock)
      .mockRejectedValueOnce(new Error('synthetic private detail'));
    renderProfile();
    fireEvent.click(await screen.findByRole('checkbox'));
    const reload = await screen.findByRole('button', { name: 'Reload settings' });

    fireEvent.click(reload);

    expect(await screen.findByRole('checkbox')).toBeChecked();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
    expect(document.body).not.toHaveTextContent('synthetic private detail');
  });

  test('treats a post-mutation refetch failure as unknown', async () => {
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockRejectedValueOnce(new Error('synthetic private detail'));
    renderProfile();
    fireEvent.click(await screen.findByRole('checkbox'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not confirm that change/i,
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('keeps stale app and account loads from replacing the current settings', async () => {
    const staleLoad = deferred<typeof DEFAULT_PROFILE>();
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO);
    const view = renderProfile();

    view.rerender(
      <MemberDirectoryProfile
        app={otherApp}
        uid="other-synthetic-user"
        hasDisplayName
      />,
    );

    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
    await act(async () => staleLoad.resolve(DEFAULT_PROFILE));
    expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(getMyMemberDirectoryProfile).toHaveBeenNthCalledWith(1, app);
    expect(getMyMemberDirectoryProfile).toHaveBeenNthCalledWith(2, otherApp);
  });

  test('makes an old mutation completion inert after an app or account change', async () => {
    const oldMutation = deferred<unknown>();
    (setMyMemberDirectoryVisibility as jest.Mock).mockReturnValueOnce(oldMutation.promise);
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO);
    const view = renderProfile();
    fireEvent.click(await screen.findByRole('checkbox'));

    view.rerender(
      <MemberDirectoryProfile
        app={otherApp}
        uid="other-synthetic-user"
        hasDisplayName
      />,
    );
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
    await act(async () => oldMutation.resolve({}));

    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.queryByText('Officer finder is on.')).not.toBeInTheDocument();
  });

  test('ignores an initial load completion after unmount', async () => {
    const load = deferred<typeof DEFAULT_PROFILE>();
    (getMyMemberDirectoryProfile as jest.Mock).mockReturnValueOnce(load.promise);
    const view = renderProfile();

    view.unmount();
    await act(async () => load.resolve(DEFAULT_PROFILE));

    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
  });

  test('provides programmatic descriptions and an accessible processed-photo preview', async () => {
    (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValue(PROFILE_WITH_PHOTO);
    renderProfile();

    const image = await screen.findByRole('img', { name: 'Your current profile thumbnail' });
    expect(image).toHaveAttribute('width', '128');
    expect(image).toHaveAttribute('height', '128');
    const file = screen.getByLabelText('Replace profile photo');
    expect(file.getAttribute('aria-describedby')).toContain('member-directory-file-help');
    expect(file.getAttribute('aria-describedby')).toContain(
      'member-directory-privacy-description',
    );
    expect(screen.getByRole('checkbox').getAttribute('aria-describedby')).toContain(
      'member-directory-privacy-description',
    );
    expect(screen.getByRole('button', { name: 'Remove profile photo' })).toBeEnabled();
  });

  test('keeps the light panel heading readable and bounds the native file input', () => {
    const css = readFileSync(join(__dirname, 'Account.css'), 'utf8');

    expect(css).toMatch(/\.member-directory-profile h2\s*\{[\s\S]*color:\s*#111827;/);
    expect(css).toMatch(
      /\.member-directory-profile__photo-actions,\s*\.member-directory-profile__photo-actions input\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/,
    );
  });
});
