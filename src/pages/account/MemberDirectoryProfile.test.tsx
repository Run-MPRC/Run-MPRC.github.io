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
  MemberDirectoryProfile as MemberDirectoryProfileData,
  removeMyMemberDirectoryPhoto,
  setMyMemberDirectoryPhoto,
  setMyMemberDirectoryVisibility,
} from '../../services/account/memberDirectoryService';
import MemberDirectoryProfile, {
  isMemberDirectoryDisplayNameEligible,
} from './MemberDirectoryProfile';

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

function installDeferredFileReader() {
  const OriginalFileReader = globalThis.FileReader;
  const readers: Array<{
    complete: (bytes: string, type?: string) => void;
    fail: () => void;
  }> = [];
  class DeferredFileReader {
    result: string | null = null;

    onload: (() => void) | null = null;

    onerror: (() => void) | null = null;

    onabort: (() => void) | null = null;

    readAsDataURL(file: File) {
      readers.push({
        complete: (bytes, type = file.type) => {
          this.result = `data:${type};base64,${btoa(bytes)}`;
          this.onload?.();
        },
        fail: () => this.onerror?.(),
      });
    }
  }
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    writable: true,
    value: DeferredFileReader,
  });
  return {
    readers,
    restore() {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        writable: true,
        value: OriginalFileReader,
      });
    },
  };
}

function renderProfile({
  firebaseApp = app,
  uid = 'synthetic-user',
  displayName = 'Synthetic Member',
  backendAvailable = true,
}: {
  firebaseApp?: typeof app;
  uid?: string;
  displayName?: string | null;
  backendAvailable?: boolean;
} = {}) {
  return render(
    <MemberDirectoryProfile
      app={firebaseApp}
      uid={uid}
      displayName={displayName}
      backendAvailable={backendAvailable}
    />,
  );
}

describe('MEMBERS-DIRECTORY-001E display-name eligibility', () => {
  test.each([
    ['ordinary synthetic name', 'Synthetic Member'],
    ['NFKC-normalized synthetic name', '\uff33\uff39\uff2e\uff34\uff28\uff25\uff34\uff29\uff23'],
    ['combining-mark synthetic name', 'A\u0301B'],
    ['one supplementary Unicode letter occupying two UTF-16 units', '\ud801\udc00'],
    ['exact raw and canonical bound', 'x'.repeat(200)],
  ])('accepts an eligible %s', (_label, displayName) => {
    expect(isMemberDirectoryDisplayNameEligible(displayName)).toBe(true);
  });

  test.each([
    ['missing name', null],
    ['empty name', ''],
    ['blank name', '   '],
    ['one-unit Latin name text', 'A'],
    ['one-unit non-Latin name text', '\u4e2d'],
    ['one-unit lowercase expansion candidate', '\u00df'],
    ['punctuation-only name', '--'],
    ['punctuation around one-unit name text', '-A-'],
    ['control character', 'Synthetic\u0085Member'],
    ['format character', 'Synthetic\u200dMember'],
    ['unpaired high surrogate', 'Synthetic\ud800Member'],
    ['unpaired low surrogate', 'Synthetic\udc00Member'],
    ['raw text over the UTF-16 bound', 'x'.repeat(201)],
    ['NFKC expansion over the canonical bound', '\ufdfa'.repeat(12)],
  ])('rejects an ineligible %s', (_label, displayName) => {
    expect(isMemberDirectoryDisplayNameEligible(displayName)).toBe(false);
  });
});

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

  test('defaults to an inert, explicitly unavailable interface preview', () => {
    const hostileApp = new Proxy({}, {
      get() {
        throw new Error('preview-must-not-inspect-app');
      },
    }) as any;
    render(
      <MemberDirectoryProfile
        app={hostileApp}
        uid="synthetic-user"
        displayName="Synthetic Member"
      />,
    );

    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Profile photo and officer finder',
    })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Interface preview — not connected yet.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'No photo or finder setting is read, uploaded, searched, or saved',
    );
    expect(screen.getByRole('img', { name: 'Profile photo preview' }))
      .toBeInTheDocument();
    const file = screen.getByLabelText('Add profile photo (not available yet)');
    const checkbox = screen.getByRole('checkbox', {
      name: 'Let authorized officers find me by name (not available yet)',
    });
    expect(file).toBeDisabled();
    expect(file).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(file.getAttribute('aria-describedby')).toContain(
      'member-directory-preview-status',
    );
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(checkbox.getAttribute('aria-describedby')).toContain(
      'member-directory-preview-status',
    );
    expect(screen.getByText(/uploading, replacing, or removing it will not turn on/i))
      .toBeInTheDocument();
    expect(screen.getByText(/will not accept a photo as a query/i)).toBeInTheDocument();
    expect(screen.getByText(/will not.*facial recognition or image matching/i))
      .toBeInTheDocument();

    fireEvent.change(file, {
      target: {
        files: [new File(['synthetic'], 'fixture-001.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(checkbox);

    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
    expect(getMyMemberDirectoryProfile).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('preview-must-not-inspect-app');
  });

  test('describes the future name prerequisite without enabling preview controls', () => {
    render(
      <MemberDirectoryProfile
        app={app}
        uid="synthetic-user"
        displayName={null}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: 'Let authorized officers find me by name (not available yet)',
    });
    expect(checkbox).toBeDisabled();
    expect(checkbox.getAttribute('aria-describedby')).toContain(
      'member-directory-name-required-preview',
    );
    expect(screen.getByText(/eligible name in the Profile section will also be required/i))
      .toBeInTheDocument();
    expect(getMyMemberDirectoryProfile).not.toHaveBeenCalled();
  });

  test('loads missing settings as private by default with separate photo controls', async () => {
    renderProfile();

    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Profile photo and officer finder',
    })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'No profile photo' }))
      .toBeInTheDocument();
    expect(screen.getByRole('checkbox', {
      name: 'Let verified website administrators find me by name',
    })).not.toBeChecked();
    expect(screen.getByLabelText('Add profile photo')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
    expect(screen.queryByRole('button', { name: 'Remove current saved photo' }))
      .not.toBeInTheDocument();
    expect(screen.getByText(/search result does not prove current club membership/i))
      .toBeInTheDocument();
    expect(screen.getByText(/turning it off prevents later searches ordered after the change/i))
      .toBeInTheDocument();
    expect(screen.getByText(/earlier completed search cannot be recalled and its response may arrive afterward/i))
      .toBeInTheDocument();
    expect(screen.getByText(/private thumbnail stays stored until you remove it/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not use facial recognition or image matching/i))
      .toBeInTheDocument();
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
  });

  test('MEMBERS-DIRECTORY-001F previews a valid image locally before an explicit save', async () => {
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
    const file = new File(['synthetic pixels'], 'fixture-002.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    expect(preview).toHaveAttribute(
      'src',
      `data:image/png;base64,${btoa('synthetic pixels')}`,
    );
    expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeDisabled();
    fireEvent.load(preview);

    expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Selected photo preview is ready. It has not been uploaded.',
    );
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('fixture-002.png');

    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

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
    expect(screen.getByLabelText('Replace profile photo')).toHaveFocus();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
  });

  test('MEMBERS-DIRECTORY-001F cancels a selected photo without creating a request or calling a service', async () => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');

    fireEvent.change(input, {
      target: {
        files: [new File(['synthetic pixels'], 'fixture-003.png', {
          type: 'image/png',
        })],
      },
    });

    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected photo' }));

    expect(screen.getByRole('img', { name: 'No profile photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile photo' }))
      .not.toBeInTheDocument();
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('fixture-003.png');
    expect(input).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Selected photo discarded. Nothing was uploaded.',
    );
  });

  test('MEMBERS-DIRECTORY-001F keeps a replacement draft local and restores the saved photo on Cancel', async () => {
    (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValue(PROFILE_WITH_PHOTO);
    renderProfile();
    const input = await screen.findByLabelText('Replace profile photo');
    const current = screen.getByRole('img', { name: 'Your current profile thumbnail' });

    fireEvent.change(input, {
      target: {
        files: [new File(['local replacement'], 'fixture-004.png', {
          type: 'image/png',
        })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);

    expect(current).toHaveAttribute('src', `data:image/webp;base64,${PHOTO.base64Data}`);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected photo' }));

    expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
      .toHaveAttribute('src', `data:image/webp;base64,${PHOTO.base64Data}`);
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('fixture-004.png');
  });

  test('MEMBERS-DIRECTORY-001F replaces an existing photo without changing visibility', async () => {
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
    const file = new File(['replacement pixels'], 'fixture-005.webp', {
      type: 'image/webp',
    });

    fireEvent.change(input, { target: { files: [file] } });

    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
      .toHaveAttribute('src', `data:image/webp;base64,${PHOTO.base64Data}`);
    expect(screen.getByRole('heading', {
      level: 3,
      name: 'Selected photo — not uploaded yet',
    })).toBeInTheDocument();
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

    await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 4,
      contentType: 'image/webp',
      base64Data: btoa('replacement pixels'),
    }));
    expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toHaveAttribute('src', `data:image/webp;base64,${replacement.photo.base64Data}`);
  });

  test.each([
    [
      'unsupported type',
      () => new File(['synthetic'], 'fixture-006.gif', { type: 'image/gif' }),
      /choose a JPG, PNG, or WebP image/i,
    ],
    [
      'oversized image',
      () => new File(
        [new Uint8Array((2 * 1024 * 1024) + 1)],
        'fixture-007.png',
        { type: 'image/png' },
      ),
      /2 MiB or smaller/i,
    ],
    [
      'empty image',
      () => new File([], 'fixture-008.webp', { type: 'image/webp' }),
      /non-empty image/i,
    ],
  ])('MEMBERS-DIRECTORY-001F rejects an %s before reading or uploading', async (_label, makeFile, message) => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');

    fireEvent.change(input, { target: { files: [makeFile()] } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveAttribute('id', 'member-directory-action-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-action-error',
    );
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
  });

  test('MEMBERS-DIRECTORY-001F keeps a valid draft when the chooser closes without selecting a file', async () => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['synthetic pixels'], 'fixture-009.png', {
          type: 'image/png',
        })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);

    fireEvent.change(input, { target: { files: [] } });

    expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeEnabled();
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
  });

  test('MEMBERS-DIRECTORY-001F does not read or render a selected local filename', async () => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    const file = new File(['synthetic pixels'], 'fixture-010.png', { type: 'image/png' });
    Object.defineProperty(file, 'name', {
      configurable: true,
      get() {
        throw new Error('filename-access-canary');
      },
    });

    fireEvent.change(input, { target: { files: [file] } });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);

    expect(preview).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('filename-access-canary');
    expect(document.body).not.toHaveTextContent('fixture-010.png');
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
  });

  test('MEMBERS-DIRECTORY-001F cancels during a deferred read and makes its late completion inert', async () => {
    const deferredReader = installDeferredFileReader();
    try {
      renderProfile();
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['late bytes'], 'fixture-011.png', { type: 'image/png' })],
        },
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Preparing selected photo preview...',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel selected photo' }));

      await act(async () => deferredReader.readers[0].complete('late bytes'));

      expect(screen.getByRole('img', { name: 'No profile photo' })).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
        .not.toBeInTheDocument();
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    } finally {
      deferredReader.restore();
    }
  });

  test('MEMBERS-DIRECTORY-001F keeps only the newest selection when an older read finishes late', async () => {
    const deferredReader = installDeferredFileReader();
    try {
      renderProfile();
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['old bytes'], 'fixture-012.png', { type: 'image/png' })],
        },
      });
      fireEvent.change(input, {
        target: {
          files: [new File(['new bytes'], 'fixture-013.webp', { type: 'image/webp' })],
        },
      });

      await act(async () => deferredReader.readers[1].complete('new bytes'));
      const preview = screen.getByRole('img', { name: 'Selected profile photo preview' });
      expect(preview).toHaveAttribute(
        'src',
        `data:image/webp;base64,${btoa('new bytes')}`,
      );
      fireEvent.load(preview);
      await act(async () => deferredReader.readers[0].complete('old bytes'));

      expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
        .toHaveAttribute('src', `data:image/webp;base64,${btoa('new bytes')}`);
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    } finally {
      deferredReader.restore();
    }
  });

  test('MEMBERS-DIRECTORY-001F invalidates an older pending read when a newer selection is invalid', async () => {
    const deferredReader = installDeferredFileReader();
    try {
      renderProfile();
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['old bytes'], 'fixture-014.png', { type: 'image/png' })],
        },
      });
      fireEvent.change(input, {
        target: {
          files: [new File(['invalid bytes'], 'fixture-015.gif', { type: 'image/gif' })],
        },
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Choose a JPG, PNG, or WebP image.',
      );

      await act(async () => deferredReader.readers[0].complete('old bytes'));

      expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save profile photo' }))
        .not.toBeInTheDocument();
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    } finally {
      deferredReader.restore();
    }
  });

  test('MEMBERS-DIRECTORY-001F rejects an unreadable image without creating a request or retaining a draft', async () => {
    const deferredReader = installDeferredFileReader();
    try {
      renderProfile();
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['synthetic pixels'], 'fixture-016.png', {
            type: 'image/png',
          })],
        },
      });
      await act(async () => deferredReader.readers[0].fail());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'We could not read that image. Choose the file again.',
      );
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('button', { name: 'Save profile photo' }))
        .not.toBeInTheDocument();
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('fixture-016.png');
    } finally {
      deferredReader.restore();
    }
  });

  test('MEMBERS-DIRECTORY-001F rejects a browser-unrenderable image and removes its byte-bearing draft', async () => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['not renderable'], 'fixture-017.png', {
          type: 'image/png',
        })],
      },
    });
    fireEvent.error(await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That image could not be displayed. Choose another image.',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-action-error',
    );
    expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile photo' }))
      .not.toBeInTheDocument();
    expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(btoa('not renderable'));
    expect(document.body).not.toHaveTextContent('fixture-017.png');
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
      name: 'Let verified website administrators find me by name',
    });

    fireEvent.click(checkbox);

    await waitFor(() => expect(setMyMemberDirectoryVisibility).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 0,
      searchableByOfficers: true,
    }));
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    expect(await screen.findByRole('checkbox', {
      name: 'Let verified website administrators find me by name',
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
      name: 'Let verified website administrators find me by name',
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

  test.each([
    ['missing', null],
    ['one-unit', 'A'],
    ['punctuation-only', '---'],
    ['format-containing', 'Synthetic\u200dMember'],
    ['canonical expansion beyond the bound', '\ufdfa'.repeat(12)],
  ])(
    'requires an eligible display name before opt-in for a %s name',
    async (_label, displayName) => {
      renderProfile({ displayName });

      const checkbox = await screen.findByRole('checkbox', {
        name: 'Let verified website administrators find me by name',
      });
      expect(checkbox).toBeDisabled();
      expect(screen.getByText(/current Profile name is not eligible/i))
        .toBeInTheDocument();
      expect(screen.getByLabelText('Add profile photo')).toBeEnabled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    },
  );

  test('recomputes new opt-in eligibility when the current saved name changes', async () => {
    const view = renderProfile({ displayName: 'Synthetic Member' });
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let verified website administrators find me by name',
    });
    expect(checkbox).toBeEnabled();
    expect(screen.queryByText(/current Profile name is not eligible/i))
      .not.toBeInTheDocument();

    view.rerender(
      <MemberDirectoryProfile
        app={app}
        uid="synthetic-user"
        displayName="A"
        backendAvailable
      />,
    );
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/current Profile name is not eligible/i))
      .toBeInTheDocument();

    view.rerender(
      <MemberDirectoryProfile
        app={app}
        uid="synthetic-user"
        displayName="Restored Synthetic Member"
        backendAvailable
      />,
    );
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(screen.queryByText(/current Profile name is not eligible/i))
      .not.toBeInTheDocument();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
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
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeEnabled();
    expect(checkbox).not.toHaveAttribute('aria-invalid');
    expect(checkbox.getAttribute('aria-describedby')).toContain(
      'member-directory-action-error',
    );
    expect(screen.getByLabelText('Add profile photo')).toBeEnabled();
    expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('synthetic crypto unavailable');
  });

  test('MEMBERS-DIRECTORY-001F retains a decoded photo draft when request-ID creation fails and allows retry', async () => {
    (createMemberDirectoryRequestId as jest.Mock)
      .mockImplementationOnce(() => {
        throw new Error('synthetic crypto unavailable');
      })
      .mockReturnValueOnce(REQUEST_ID);
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
    fireEvent.change(input, {
      target: {
        files: [new File(['retry bytes'], 'fixture-018.png', { type: 'image/png' })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    const save = screen.getByRole('button', { name: 'Save profile photo' });

    fireEvent.click(save);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not safely start that change/i,
    );
    expect(save).toBeEnabled();
    expect(preview).toBeInTheDocument();
    expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();

    fireEvent.click(save);

    await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1));
    expect(setMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 0,
      contentType: 'image/png',
      base64Data: btoa('retry bytes'),
    });
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
  });

  test('MEMBERS-DIRECTORY-001F guards rapid Save clicks before creating a second request or service call', async () => {
    const request = deferred<unknown>();
    (setMyMemberDirectoryPhoto as jest.Mock).mockReturnValueOnce(request.promise);
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['rapid bytes'], 'fixture-019.png', { type: 'image/png' })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    const save = screen.getByRole('button', { name: 'Save profile photo' });

    fireEvent.click(save);
    fireEvent.click(save);

    expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
    expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
  });

  test('keeps an existing opt-in removable but hidden when the display name is ineligible', async () => {
    const hiddenProfile = {
      ...PROFILE_WITH_PHOTO,
      revision: 5,
      searchableByOfficers: false,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(hiddenProfile);
    renderProfile({ displayName: 'Synthetic\u200dMember' });

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let verified website administrators find me by name',
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(checkbox.getAttribute('aria-describedby')).toContain(
      'member-directory-name-required',
    );
    expect(screen.getByText(/officers cannot find you while your current Profile name is ineligible/i))
      .toBeInTheDocument();
    expect(screen.getByText(/you can still turn the setting off/i)).toBeInTheDocument();

    fireEvent.click(checkbox);

    await waitFor(() => expect(setMyMemberDirectoryVisibility).toHaveBeenCalledWith(
      app,
      {
        requestId: REQUEST_ID,
        expectedRevision: 4,
        searchableByOfficers: false,
      },
    ));
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Officer finder is off.');
  });

  describe('MEMBERS-DIRECTORY-001H saved-photo removal with a local draft', () => {
    async function selectReadyReplacement(bytes: string, filename: string) {
      const input = await screen.findByLabelText('Replace profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File([bytes], filename, { type: 'image/png' })],
        },
      });
      const preview = await screen.findByRole('img', {
        name: 'Selected profile photo preview',
      });
      fireEvent.load(preview);
      return { input, preview };
    }

    test('preserves a ready replacement after confirmed removal and focuses its Save action', async () => {
      const refreshed = {
        ...PROFILE_WITH_PHOTO,
        revision: 5,
        hasPhoto: false,
        photo: null,
      };
      const saved = {
        ...refreshed,
        revision: 6,
        hasPhoto: true,
        photo: {
          ...PHOTO,
          version: '22222222-2222-4222-8222-222222222222',
        },
      };
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockResolvedValueOnce(refreshed)
        .mockResolvedValueOnce(saved);
      renderProfile();
      await selectReadyReplacement('preserved replacement', 'fixture-001h-001.png');

      fireEvent.click(screen.getByRole('button', { name: 'Remove current saved photo' }));

      expect(await screen.findByRole('img', { name: 'No profile photo' }))
        .toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
        .toHaveAttribute(
          'src',
          `data:image/png;base64,${btoa('preserved replacement')}`,
        );
      expect(screen.getByRole('button', { name: 'Save profile photo' }))
        .toHaveFocus();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

      await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
        requestId: REQUEST_ID,
        expectedRevision: 5,
        contentType: 'image/png',
        base64Data: btoa('preserved replacement'),
      }));
      expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
      expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(2);
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
        .toBeInTheDocument();
    });

    test('lets the current FileReader finish locally after confirmed removal and focuses the input while it is reading', async () => {
      const deferredReader = installDeferredFileReader();
      try {
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
        const input = await screen.findByLabelText('Replace profile photo');
        fireEvent.change(input, {
          target: {
            files: [new File(['reading replacement'], 'fixture-001h-002.png', {
              type: 'image/png',
            })],
          },
        });
        expect(screen.getByText('Preparing selected photo preview...'))
          .toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {
          name: 'Remove current saved photo',
        }));

        expect(await screen.findByRole('img', { name: 'No profile photo' }))
          .toBeInTheDocument();
        expect(screen.getByLabelText('Add profile photo')).toHaveFocus();
        expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
        expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);

        await act(async () => deferredReader.readers[0].complete('reading replacement'));
        const preview = await screen.findByRole('img', {
          name: 'Selected profile photo preview',
        });
        expect(preview).toHaveAttribute(
          'src',
          `data:image/png;base64,${btoa('reading replacement')}`,
        );
        fireEvent.load(preview);
        expect(screen.getByRole('button', { name: 'Save profile photo' }))
          .toBeEnabled();
        expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      } finally {
        deferredReader.restore();
      }
    });

    test('keeps only the current reselection when deferred reads finish after confirmed removal', async () => {
      const deferredReader = installDeferredFileReader();
      try {
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
        const input = await screen.findByLabelText('Replace profile photo');
        fireEvent.change(input, {
          target: {
            files: [new File(['stale replacement'], 'fixture-001h-003.png', {
              type: 'image/png',
            })],
          },
        });
        fireEvent.change(input, {
          target: {
            files: [new File(['current replacement'], 'fixture-001h-004.png', {
              type: 'image/png',
            })],
          },
        });

        fireEvent.click(screen.getByRole('button', {
          name: 'Remove current saved photo',
        }));
        expect(await screen.findByRole('img', { name: 'No profile photo' }))
          .toBeInTheDocument();

        await act(async () => deferredReader.readers[0].complete('stale replacement'));
        expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
          .not.toBeInTheDocument();
        await act(async () => deferredReader.readers[1].complete('current replacement'));

        expect(await screen.findByRole('img', {
          name: 'Selected profile photo preview',
        })).toHaveAttribute(
          'src',
          `data:image/png;base64,${btoa('current replacement')}`,
        );
        expect(document.body.innerHTML).not.toContain(btoa('stale replacement'));
        expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      } finally {
        deferredReader.restore();
      }
    });

    test('preserves the ready draft and associates a fixed error after a definitive rejected remove readback', async () => {
      const rejected = { code: 'functions/failed-precondition' };
      const current = { ...PROFILE_WITH_PHOTO, revision: 7 };
      (removeMyMemberDirectoryPhoto as jest.Mock).mockRejectedValueOnce(rejected);
      (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
        (error) => error === rejected,
      );
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockResolvedValueOnce(current);
      renderProfile();
      await selectReadyReplacement('rejected replacement', 'fixture-001h-005.png');

      fireEvent.click(screen.getByRole('button', {
        name: 'Remove current saved photo',
      }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That change was rejected before it was saved. Review the requirements and try again.',
      );
      expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
        .toHaveAttribute(
          'src',
          `data:image/png;base64,${btoa('rejected replacement')}`,
        );
      expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Remove current saved photo' })
        .getAttribute('aria-describedby')).toContain('member-directory-action-error');
      expect(screen.getByRole('checkbox')).toBeChecked();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    });

    test.each([
      ['outcome is unknown', false],
      ['successful mutation readback fails', true],
    ])('discards draft bytes and hides connected controls when the remove %s', async (_label, resolves) => {
      if (resolves) {
        (removeMyMemberDirectoryPhoto as jest.Mock).mockResolvedValueOnce({});
        (getMyMemberDirectoryProfile as jest.Mock)
          .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
          .mockRejectedValueOnce(new Error('synthetic private readback detail'));
      } else {
        (removeMyMemberDirectoryPhoto as jest.Mock)
          .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
        (getMyMemberDirectoryProfile as jest.Mock)
          .mockResolvedValueOnce(PROFILE_WITH_PHOTO);
      }
      renderProfile();
      await selectReadyReplacement('discarded replacement', 'fixture-001h-006.png');

      fireEvent.click(screen.getByRole('button', {
        name: 'Remove current saved photo',
      }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /could not confirm that change/i,
      );
      expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save profile photo' }))
        .not.toBeInTheDocument();
      expect(screen.queryByLabelText('Replace profile photo')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Add profile photo')).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain(btoa('discarded replacement'));
      expect(document.body).not.toHaveTextContent('synthetic private');
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test('focuses the file input after confirmed removal with no local draft and leaves visibility on', async () => {
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
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });

      fireEvent.click(remove);

      await waitFor(() => expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
        requestId: REQUEST_ID,
        expectedRevision: 4,
      }));
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      expect(await screen.findByRole('img', { name: 'No profile photo' }))
        .toBeInTheDocument();
      expect(screen.getByRole('checkbox', {
        name: 'Let verified website administrators find me by name',
      })).toBeChecked();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Profile photo removed. Your officer finder setting did not change.',
      );
      expect(screen.getByLabelText('Add profile photo')).toHaveFocus();
    });

    test('focuses the still-current saved-photo remove action after concurrent restoration', async () => {
      const changedAgain = {
        ...PROFILE_WITH_PHOTO,
        revision: 6,
        photo: { ...PHOTO, version: '22222222-2222-4222-8222-222222222222' },
      };
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockResolvedValueOnce(changedAgain);
      renderProfile();
      await selectReadyReplacement('concurrent replacement', 'fixture-001h-007.png');

      fireEvent.click(await screen.findByRole('button', {
        name: 'Remove current saved photo',
      }));

      expect(await screen.findByText(
        'Profile photo changed again elsewhere. The preview shows the current photo.',
      )).toHaveAttribute('role', 'status');
      expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
        .toBeInTheDocument();
      expect(screen.queryByText(
        'Profile photo removed. Your officer finder setting did not change.',
      )).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
        .toHaveAttribute(
          'src',
          `data:image/png;base64,${btoa('concurrent replacement')}`,
        );
      expect(screen.getByRole('button', { name: 'Remove current saved photo' }))
        .toHaveFocus();
    });

    test.each([
      ['application', otherApp, 'synthetic-user'],
      ['account', app, 'other-synthetic-user'],
    ])('makes an old remove completion inert after the %s changes', async (_label, nextApp, nextUid) => {
      const oldRemove = deferred<unknown>();
      (removeMyMemberDirectoryPhoto as jest.Mock).mockReturnValueOnce(oldRemove.promise);
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockResolvedValueOnce(DEFAULT_PROFILE);
      const view = renderProfile();
      await selectReadyReplacement('old-context replacement', 'fixture-001h-008.png');
      fireEvent.click(screen.getByRole('button', {
        name: 'Remove current saved photo',
      }));

      view.rerender(
        <MemberDirectoryProfile
          app={nextApp}
          uid={nextUid}
          displayName="Current Synthetic Member"
          backendAvailable
        />,
      );
      expect(await screen.findByRole('img', { name: 'No profile photo' }))
        .toBeInTheDocument();
      await act(async () => oldRemove.resolve({}));

      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
        .not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain(btoa('old-context replacement'));
      expect(screen.getByLabelText('Add profile photo')).not.toHaveFocus();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test('makes an old remove completion inert after unmount', async () => {
      const oldRemove = deferred<unknown>();
      (removeMyMemberDirectoryPhoto as jest.Mock).mockReturnValueOnce(oldRemove.promise);
      (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValueOnce(PROFILE_WITH_PHOTO);
      const view = renderProfile();
      await selectReadyReplacement('unmounted replacement', 'fixture-001h-009.png');
      fireEvent.click(screen.getByRole('button', {
        name: 'Remove current saved photo',
      }));

      view.unmount();
      await act(async () => oldRemove.resolve({}));

      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });
  });

  describe('MEMBERS-DIRECTORY-001M rejected-removal focus recovery', () => {
    const rejected = { code: 'functions/failed-precondition' };
    const WITHOUT_PHOTO: MemberDirectoryProfileData = {
      ...PROFILE_WITH_PHOTO,
      revision: 7,
      hasPhoto: false,
      photo: null,
    };

    function arrangeRejectedRemoval(
      current: MemberDirectoryProfileData = WITHOUT_PHOTO,
    ) {
      const removal = deferred<unknown>();
      const readback = deferred<MemberDirectoryProfileData>();
      (removeMyMemberDirectoryPhoto as jest.Mock).mockReturnValueOnce(removal.promise);
      (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
        (error) => error === rejected,
      );
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockReturnValueOnce(readback.promise);
      return {
        removal,
        readback,
        settle: async () => {
          await act(async () => {
            removal.reject(rejected);
            await Promise.resolve();
          });
          await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
          await act(async () => readback.resolve(current));
        },
      };
    }

    function modelDisabledControlFocusEviction(control: HTMLElement) {
      control.blur();
      const disposable = document.createElement('button');
      document.body.appendChild(disposable);
      disposable.focus();
      expect(disposable).toHaveFocus();
      disposable.remove();
      expect(document.body).toHaveFocus();
    }

    async function selectReplacement({
      previewState = 'ready',
    }: {
      previewState?: 'ready' | 'loading';
    } = {}) {
      const input = await screen.findByLabelText('Replace profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['001m replacement'], 'fixture-001m.png', {
            type: 'image/png',
          })],
        },
      });
      const preview = await screen.findByRole('img', {
        name: 'Selected profile photo preview',
      });
      if (previewState === 'ready') fireEvent.load(preview);
      return { input, preview };
    }

    test('restores the persistent file input after focused Remove disappears on a definitive rejection readback', async () => {
      const attempt = arrangeRejectedRemoval();
      renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();

      fireEvent.click(remove);

      expect(remove).toBeDisabled();
      modelDisabledControlFocusEviction(remove);
      await attempt.settle();

      const input = screen.getByLabelText('Add profile photo');
      expect(input).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Remove current saved photo' }))
        .not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'That change was rejected before it was saved. Review the requirements and try again.',
      );
      expect(input.getAttribute('aria-describedby'))
        .not.toContain('member-directory-action-error');
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
    });

    test('restores the ready replacement Save action without attaching the Remove rejection to it', async () => {
      const attempt = arrangeRejectedRemoval();
      renderProfile();
      await selectReplacement();
      const remove = screen.getByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();

      fireEvent.click(remove);

      expect(remove).toBeDisabled();
      modelDisabledControlFocusEviction(remove);
      await attempt.settle();

      const save = screen.getByRole('button', { name: 'Save profile photo' });
      const input = screen.getByLabelText('Add profile photo');
      expect(save).toHaveFocus();
      expect(save.getAttribute('aria-describedby'))
        .not.toContain('member-directory-action-error');
      expect(input.getAttribute('aria-describedby'))
        .not.toContain('member-directory-action-error');
      expect(screen.getByRole('alert')).toHaveTextContent(/rejected before it was saved/i);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test('falls back to the file input while the replacement preview is not ready', async () => {
      const attempt = arrangeRejectedRemoval();
      renderProfile();
      await selectReplacement({ previewState: 'loading' });
      const remove = screen.getByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      fireEvent.click(remove);
      modelDisabledControlFocusEviction(remove);

      await attempt.settle();

      expect(screen.getByLabelText('Add profile photo')).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeDisabled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test('falls back to the file input while a replacement is still being read', async () => {
      const reader = installDeferredFileReader();
      try {
        const attempt = arrangeRejectedRemoval();
        renderProfile();
        const input = await screen.findByLabelText('Replace profile photo');
        fireEvent.change(input, {
          target: {
            files: [new File(['001m reading'], 'fixture-001m-reading.png', {
              type: 'image/png',
            })],
          },
        });
        expect(screen.getByText('Preparing selected photo preview...')).toBeInTheDocument();
        const remove = screen.getByRole('button', {
          name: 'Remove current saved photo',
        });
        remove.focus();
        fireEvent.click(remove);
        modelDisabledControlFocusEviction(remove);

        await attempt.settle();

        expect(screen.getByLabelText('Add profile photo')).toHaveFocus();
        expect(screen.queryByRole('button', { name: 'Save profile photo' }))
          .not.toBeInTheDocument();
        expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      } finally {
        reader.restore();
      }
    });

    test('restores a surviving Remove action and keeps its fixed error association', async () => {
      const current = {
        ...PROFILE_WITH_PHOTO,
        revision: 7,
        photo: { ...PHOTO, version: '22222222-2222-4222-8222-222222222222' },
      };
      const attempt = arrangeRejectedRemoval(current);
      renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      fireEvent.click(remove);
      modelDisabledControlFocusEviction(remove);

      await attempt.settle();

      const survivingRemove = screen.getByRole('button', {
        name: 'Remove current saved photo',
      });
      expect(survivingRemove).toHaveFocus();
      expect(survivingRemove.getAttribute('aria-describedby'))
        .toContain('member-directory-action-error');
    });

    test('does not redundantly focus a surviving Remove action that retained focus', async () => {
      const current = { ...PROFILE_WITH_PHOTO, revision: 7 };
      const attempt = arrangeRejectedRemoval(current);
      renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      const focus = jest.spyOn(remove, 'focus');

      fireEvent.click(remove);
      expect(remove).toHaveFocus();
      await attempt.settle();

      expect(remove).toHaveFocus();
      expect(focus).not.toHaveBeenCalled();
      focus.mockRestore();
    });

    test('creates no focus intent for an outside-focused programmatic Remove invocation', async () => {
      const attempt = arrangeRejectedRemoval();
      render(
        <>
          <button type="button">Outside control</button>
          <MemberDirectoryProfile
            app={app}
            uid="synthetic-user"
            displayName="Synthetic Member"
            backendAvailable
          />
        </>,
      );
      const outside = screen.getByRole('button', { name: 'Outside control' });
      outside.focus();

      fireEvent.click(await screen.findByRole('button', {
        name: 'Remove current saved photo',
      }));
      await attempt.settle();

      expect(outside).toHaveFocus();
      expect(screen.getByLabelText('Add profile photo')).not.toHaveFocus();
    });

    test('preserves a deliberately selected connected control during the pending removal', async () => {
      const attempt = arrangeRejectedRemoval();
      render(
        <>
          <button type="button">Outside control</button>
          <MemberDirectoryProfile
            app={app}
            uid="synthetic-user"
            displayName="Synthetic Member"
            backendAvailable
          />
        </>,
      );
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      const outside = screen.getByRole('button', { name: 'Outside control' });
      remove.focus();
      fireEvent.click(remove);
      outside.focus();

      await attempt.settle();

      expect(outside).toHaveFocus();
      expect(screen.getByLabelText('Add profile photo')).not.toHaveFocus();
    });

    test('preserves a deliberately selected connected in-profile control during the pending removal', async () => {
      const attempt = arrangeRejectedRemoval();
      renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      fireEvent.click(remove);
      const inProfile = screen.getByRole('heading', {
        name: 'Profile photo and officer finder',
      });
      inProfile.tabIndex = -1;
      inProfile.focus();
      expect(inProfile).toHaveFocus();

      await attempt.settle();

      expect(inProfile).toHaveFocus();
      expect(screen.getByLabelText('Add profile photo')).not.toHaveFocus();
    });

    test('keeps a request-ID failure on the enabled focused Remove with zero removal call', async () => {
      (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValueOnce(PROFILE_WITH_PHOTO);
      (createMemberDirectoryRequestId as jest.Mock).mockImplementationOnce(() => {
        throw new Error('synthetic private request-id detail');
      });
      renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();

      fireEvent.click(remove);

      expect(remove).toBeEnabled();
      expect(remove).toHaveFocus();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This browser could not safely start that change. No setting was changed.',
      );
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['definitive confirming-read failure', true],
      ['ordinary unknown outcome', false],
    ])('leaves rejected-removal focus recovery to Reload after a %s', async (
      _label,
      definitive,
    ) => {
      const failure = definitive ? rejected : new Error('synthetic private outcome detail');
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockRejectedValueOnce(new Error('synthetic private confirming-read detail'));
      (removeMyMemberDirectoryPhoto as jest.Mock).mockRejectedValueOnce(failure);
      (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
        (error) => definitive && error === rejected,
      );
      renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      fireEvent.click(remove);
      modelDisabledControlFocusEviction(remove);

      const reload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(reload).toHaveFocus();
      expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(definitive ? 2 : 1);
      expect(document.body).not.toHaveTextContent('synthetic private');
    });

    test.each([
      ['application', otherApp, 'synthetic-user'],
      ['account', app, 'other-synthetic-user'],
    ])('makes an old rejected-removal focus intent inert after the %s changes', async (
      _label,
      nextApp,
      nextUid,
    ) => {
      const removal = deferred<unknown>();
      const oldReadback = deferred<MemberDirectoryProfileData>();
      (removeMyMemberDirectoryPhoto as jest.Mock).mockReturnValueOnce(removal.promise);
      (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
        (error) => error === rejected,
      );
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockReturnValueOnce(oldReadback.promise)
        .mockResolvedValueOnce(DEFAULT_PROFILE);
      const view = renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      fireEvent.click(remove);
      modelDisabledControlFocusEviction(remove);
      await act(async () => {
        removal.reject(rejected);
        await Promise.resolve();
      });
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));

      view.rerender(
        <MemberDirectoryProfile
          app={nextApp}
          uid={nextUid}
          displayName="Current Synthetic Member"
          backendAvailable
        />,
      );
      const currentInput = await screen.findByLabelText('Add profile photo');
      currentInput.focus();
      await act(async () => oldReadback.resolve(WITHOUT_PHOTO));

      expect(currentInput).toHaveFocus();
      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3);
      expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
    });

    test('makes an old rejected-removal focus intent inert after unmount', async () => {
      const removal = deferred<unknown>();
      const oldReadback = deferred<MemberDirectoryProfileData>();
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
        .mockReturnValueOnce(oldReadback.promise);
      (removeMyMemberDirectoryPhoto as jest.Mock).mockReturnValueOnce(removal.promise);
      (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
        (error) => error === rejected,
      );
      const view = renderProfile();
      const remove = await screen.findByRole('button', {
        name: 'Remove current saved photo',
      });
      remove.focus();
      fireEvent.click(remove);
      modelDisabledControlFocusEviction(remove);
      await act(async () => {
        removal.reject(rejected);
        await Promise.resolve();
      });
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
      view.unmount();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        outside.focus();
        await act(async () => oldReadback.resolve(WITHOUT_PHOTO));
        expect(outside).toHaveFocus();
        expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
      } finally {
        outside.remove();
      }
    });
  });

  test('MEMBERS-DIRECTORY-001F falls back when a saved thumbnail cannot decode and resets for a new version', async () => {
    const newPhoto = {
      ...PHOTO,
      base64Data: btoa('new synthetic processed thumbnail'),
      version: '22222222-2222-4222-8222-222222222222',
    };
    const refreshed = {
      ...PROFILE_WITH_PHOTO,
      revision: 5,
      searchableByOfficers: false,
      photo: newPhoto,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(PROFILE_WITH_PHOTO)
      .mockResolvedValueOnce(refreshed);
    renderProfile();
    const saved = await screen.findByRole('img', {
      name: 'Your current profile thumbnail',
    });

    fireEvent.error(saved);

    expect(screen.getByRole('img', {
      name: 'Saved profile photo could not be displayed',
    })).toHaveTextContent('Photo unavailable');
    expect(screen.getByRole('button', { name: 'Remove current saved photo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox'));

    const reset = await screen.findByRole('img', {
      name: 'Your current profile thumbnail',
    });
    expect(reset).toHaveAttribute(
      'src',
      `data:image/webp;base64,${newPhoto.base64Data}`,
    );
    expect(screen.getByRole('button', { name: 'Remove current saved photo' })).toBeEnabled();
  });

  test('blocks parallel mutations, then hides all controls after an unknown mutation outcome', async () => {
    const request = deferred<never>();
    (setMyMemberDirectoryVisibility as jest.Mock).mockReturnValueOnce(request.promise);
    renderProfile();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Let verified website administrators find me by name',
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

  test('MEMBERS-DIRECTORY-001F retains an upload draft after definitive rejection and retries with the refetched revision', async () => {
    const rejected = { code: 'functions/aborted' };
    const current = { ...DEFAULT_PROFILE, revision: 7 };
    const saved = {
      ...current,
      revision: 8,
      hasPhoto: true,
      photo: { ...PHOTO, version: '22222222-2222-4222-8222-222222222222' },
    };
    (setMyMemberDirectoryPhoto as jest.Mock)
      .mockRejectedValueOnce(rejected)
      .mockResolvedValueOnce({});
    (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
      (error) => error === rejected,
    );
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(saved);
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['retained bytes'], 'fixture-020.png', { type: 'image/png' })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /rejected before it was saved/i,
    );
    expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
      .toHaveAttribute('src', `data:image/png;base64,${btoa('retained bytes')}`);
    const retry = screen.getByRole('button', { name: 'Save profile photo' });
    expect(retry).toBeEnabled();

    fireEvent.click(retry);

    await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(2));
    expect(setMyMemberDirectoryPhoto).toHaveBeenNthCalledWith(2, app, {
      requestId: REQUEST_ID,
      expectedRevision: 7,
      contentType: 'image/png',
      base64Data: btoa('retained bytes'),
    });
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
  });

  test('MEMBERS-DIRECTORY-001F discards an upload draft when definitive rejection cannot be refetched', async () => {
    const rejected = { code: 'functions/failed-precondition' };
    (setMyMemberDirectoryPhoto as jest.Mock).mockRejectedValueOnce(rejected);
    (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
      (error) => error === rejected,
    );
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockRejectedValueOnce(new Error('synthetic private readback detail'));
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['discard after rejection'], 'fixture-021.png', {
          type: 'image/png',
        })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load your profile photo and officer finder settings/i,
    );
    expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile photo' }))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add profile photo')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(btoa('discard after rejection'));
    expect(document.body).not.toHaveTextContent('synthetic private');
  });

  test.each([
    ['upload outcome is unknown', false],
    ['post-upload refetch fails', true],
  ])('MEMBERS-DIRECTORY-001F discards the local draft and hides controls when the %s', async (_label, resolves) => {
    if (resolves) {
      (setMyMemberDirectoryPhoto as jest.Mock).mockResolvedValueOnce({});
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockRejectedValueOnce(new Error('synthetic private readback detail'));
    } else {
      (setMyMemberDirectoryPhoto as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
    }
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['discarded bytes'], 'fixture-022.png', { type: 'image/png' })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not confirm that change/i,
    );
    expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile photo' }))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add profile photo')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(btoa('discarded bytes'));
    expect(document.body).not.toHaveTextContent('synthetic private');
  });

  test('MEMBERS-DIRECTORY-001F treats a definitive-looking error from post-upload readback as unknown', async () => {
    const readbackFailure = { code: 'functions/permission-denied' };
    (setMyMemberDirectoryPhoto as jest.Mock).mockResolvedValueOnce({});
    (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
      (error) => error === readbackFailure,
    );
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockRejectedValueOnce(readbackFailure);
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['uncertain saved bytes'], 'fixture-023.png', {
          type: 'image/png',
        })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not confirm that change/i,
    );
    expect(screen.queryByRole('img', { name: 'Selected profile photo preview' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile photo' }))
      .not.toBeInTheDocument();
    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
    expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
    expect(document.body.innerHTML).not.toContain(btoa('uncertain saved bytes'));
    expect(document.body).not.toHaveTextContent('permission-denied');
    expect(document.body).not.toHaveTextContent('rejected before it was saved');
  });

  test('MEMBERS-DIRECTORY-001F preserves a local draft across a visibility save and uploads with its refreshed revision', async () => {
    const visibilityUpdated = {
      ...DEFAULT_PROFILE,
      revision: 1,
      searchableByOfficers: true,
    };
    const photoUpdated = {
      ...visibilityUpdated,
      revision: 2,
      hasPhoto: true,
      photo: PHOTO,
    };
    (getMyMemberDirectoryProfile as jest.Mock)
      .mockResolvedValueOnce(DEFAULT_PROFILE)
      .mockResolvedValueOnce(visibilityUpdated)
      .mockResolvedValueOnce(photoUpdated);
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['visibility-safe bytes'], 'fixture-024.png', {
          type: 'image/png',
        })],
      },
    });
    const preview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.load(preview);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(await screen.findByText('Officer finder is on.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

    await waitFor(() => expect(setMyMemberDirectoryPhoto).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      expectedRevision: 1,
      contentType: 'image/png',
      base64Data: btoa('visibility-safe bytes'),
    }));
    expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
    expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
  });

  describe('MEMBERS-DIRECTORY-001I uncertain-change reload truth', () => {
    const unknownChangeMessage = 'We could not confirm that change. Do not make another change yet. Reload settings to check what is currently saved.';

    test('keeps an ordinary unknown upload warning through failed and repeated reloads without restoring draft bytes or retrying', async () => {
      (setMyMemberDirectoryPhoto as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockRejectedValueOnce(new Error('synthetic private first reload detail'))
        .mockRejectedValueOnce(new Error('synthetic private second reload detail'));
      renderProfile();
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['uncertain local bytes'], 'fixture-001i-001.png', {
            type: 'image/png',
          })],
        },
      });
      const preview = await screen.findByRole('img', {
        name: 'Selected profile photo preview',
      });
      fireEvent.load(preview);
      fireEvent.click(screen.getByRole('button', { name: 'Save profile photo' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(unknownChangeMessage);
      expect(document.body.innerHTML).not.toContain(btoa('uncertain local bytes'));
      expect(screen.queryByLabelText('Add profile photo')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));

      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('alert')).toHaveTextContent(unknownChangeMessage);
      expect(document.body).not.toHaveTextContent('No setting was changed');
      expect(document.body.innerHTML).not.toContain(btoa('uncertain local bytes'));
      expect(screen.queryByLabelText('Add profile photo')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));

      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3));
      expect(await screen.findByRole('alert')).toHaveTextContent(unknownChangeMessage);
      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(1);
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('synthetic private');
    });

    test('keeps successful-mutation readback uncertainty through failed reloads until one authoritative read succeeds', async () => {
      const authoritative = {
        ...PROFILE_WITH_PHOTO,
        revision: 8,
        searchableByOfficers: true,
      };
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockRejectedValueOnce(new Error('synthetic private readback detail'))
        .mockRejectedValueOnce(new Error('synthetic private first reload detail'))
        .mockRejectedValueOnce(new Error('synthetic private second reload detail'))
        .mockResolvedValueOnce(authoritative);
      renderProfile();
      fireEvent.click(await screen.findByRole('checkbox'));

      expect(await screen.findByRole('alert')).toHaveTextContent(unknownChangeMessage);

      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3));
      expect(await screen.findByRole('alert')).toHaveTextContent(unknownChangeMessage);
      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(4));
      expect(await screen.findByRole('alert')).toHaveTextContent(unknownChangeMessage);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));

      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(5));
      expect(await screen.findByRole('checkbox')).toBeChecked();
      expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
        .toBeInTheDocument();
      expect(screen.queryByText(unknownChangeMessage)).not.toBeInTheDocument();
      expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(5);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test('keeps initial and definitive-rejection read failures generic without a global no-change promise', async () => {
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private initial detail'))
        .mockRejectedValueOnce(new Error('synthetic private initial reload detail'));
      const initial = renderProfile();

      const initialAlert = await screen.findByRole('alert');
      expect(initialAlert).toHaveTextContent(
        'We could not load your profile photo and officer finder settings. Reload settings to try again.',
      );
      expect(initialAlert).not.toHaveTextContent('No setting was changed');
      expect(initialAlert).not.toHaveTextContent('could not confirm that change');
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
      const initialReloadAlert = await screen.findByRole('alert');
      expect(initialReloadAlert).toHaveTextContent(
        'We could not load your profile photo and officer finder settings. Reload settings to try again.',
      );
      expect(initialReloadAlert).not.toHaveTextContent('No setting was changed');
      expect(initialReloadAlert).not.toHaveTextContent(unknownChangeMessage);
      initial.unmount();

      jest.clearAllMocks();
      (createMemberDirectoryRequestId as jest.Mock).mockReturnValue(REQUEST_ID);
      const rejected = { code: 'functions/failed-precondition' };
      (setMyMemberDirectoryVisibility as jest.Mock).mockRejectedValueOnce(rejected);
      (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
        (error) => error === rejected,
      );
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockRejectedValueOnce(new Error('synthetic private confirming detail'))
        .mockRejectedValueOnce(new Error('synthetic private reload detail'));
      renderProfile();
      fireEvent.click(await screen.findByRole('checkbox'));

      const rejectionAlert = await screen.findByRole('alert');
      expect(rejectionAlert).toHaveTextContent(
        'We could not load your profile photo and officer finder settings. Reload settings to try again.',
      );
      expect(rejectionAlert).not.toHaveTextContent(unknownChangeMessage);
      fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3));
      expect(await screen.findByRole('alert')).not.toHaveTextContent(unknownChangeMessage);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(document.body).not.toHaveTextContent('synthetic private');
    });

    test.each([
      ['application', otherApp, 'synthetic-user'],
      ['account', app, 'other-synthetic-user'],
    ])('does not carry uncertainty or a late reload into a new %s context', async (_label, nextApp, nextUid) => {
      const oldReload = deferred<typeof DEFAULT_PROFILE>();
      (setMyMemberDirectoryVisibility as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockReturnValueOnce(oldReload.promise)
        .mockRejectedValueOnce(new Error('synthetic private current load detail'));
      const view = renderProfile();
      fireEvent.click(await screen.findByRole('checkbox'));
      fireEvent.click(await screen.findByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));

      view.rerender(
        <MemberDirectoryProfile
          app={nextApp}
          uid={nextUid}
          displayName="Current Synthetic Member"
          backendAvailable
        />,
      );

      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3));
      const currentAlert = await screen.findByRole('alert');
      expect(currentAlert).toHaveTextContent(
        'We could not load your profile photo and officer finder settings. Reload settings to try again.',
      );
      expect(currentAlert).not.toHaveTextContent(unknownChangeMessage);
      await act(async () => oldReload.reject(new Error('synthetic private late reload detail')));
      expect(screen.getByRole('alert')).not.toHaveTextContent(unknownChangeMessage);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
      expect(document.body).not.toHaveTextContent('synthetic private');
    });
  });

  describe('MEMBERS-DIRECTORY-001J profile recovery focus', () => {
    async function selectReadyUpload(bytes: string) {
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File([bytes], 'fixture-001j.png', { type: 'image/png' })],
        },
      });
      const preview = await screen.findByRole('img', {
        name: 'Selected profile photo preview',
      });
      fireEvent.load(preview);
      return screen.getByRole('button', { name: 'Save profile photo' });
    }

    test.each([
      ['visibility', 'visibility'],
      ['upload', 'upload'],
      ['removal', 'remove'],
    ])('focuses Reload settings after an ordinary unknown %s outcome', async (
      _label,
      action,
    ) => {
      if (action === 'visibility') {
        (setMyMemberDirectoryVisibility as jest.Mock)
          .mockRejectedValueOnce(new Error('synthetic private visibility detail'));
      } else if (action === 'upload') {
        (setMyMemberDirectoryPhoto as jest.Mock)
          .mockRejectedValueOnce(new Error('synthetic private upload detail'));
      } else {
        (getMyMemberDirectoryProfile as jest.Mock).mockResolvedValueOnce(PROFILE_WITH_PHOTO);
        (removeMyMemberDirectoryPhoto as jest.Mock)
          .mockRejectedValueOnce(new Error('synthetic private removal detail'));
      }
      renderProfile();

      let control: HTMLElement;
      if (action === 'visibility') {
        control = await screen.findByRole('checkbox');
      } else if (action === 'upload') {
        control = await selectReadyUpload('unknown upload bytes');
      } else {
        control = await screen.findByRole('button', {
          name: 'Remove current saved photo',
        });
      }
      control.focus();
      expect(control).toHaveFocus();
      fireEvent.click(control);

      const reload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(reload).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(
        action === 'visibility' ? 1 : 0,
      );
      expect(setMyMemberDirectoryPhoto).toHaveBeenCalledTimes(action === 'upload' ? 1 : 0);
      expect(removeMyMemberDirectoryPhoto).toHaveBeenCalledTimes(action === 'remove' ? 1 : 0);
      expect(document.body).not.toHaveTextContent('synthetic private');
      if (action === 'upload') {
        expect(document.body.innerHTML).not.toContain(btoa('unknown upload bytes'));
      }
    });

    test.each([
      ['resolved mutation readback failure', false],
      ['definitive rejection confirming-read failure', true],
    ])('focuses Reload settings after a %s', async (_label, definitive) => {
      const rejected = { code: 'functions/failed-precondition' };
      if (definitive) {
        (setMyMemberDirectoryVisibility as jest.Mock).mockRejectedValueOnce(rejected);
        (isDefinitiveMemberDirectoryRejection as jest.Mock).mockImplementation(
          (error) => error === rejected,
        );
      }
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockRejectedValueOnce(new Error('synthetic private readback detail'));
      renderProfile();
      const checkbox = await screen.findByRole('checkbox');
      checkbox.focus();

      fireEvent.click(checkbox);

      const reload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(reload).toHaveFocus();
      expect(screen.getByRole('alert')).toHaveTextContent(definitive
        ? /could not load your profile photo/i
        : /could not confirm that change/i);
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('synthetic private');
    });

    test('refocuses every replacement Reload after repeated unknown-state failures without retrying the mutation', async () => {
      (setMyMemberDirectoryVisibility as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockRejectedValueOnce(new Error('synthetic private first reload detail'))
        .mockRejectedValueOnce(new Error('synthetic private second reload detail'));
      renderProfile();
      fireEvent.click(await screen.findByRole('checkbox'));
      const firstReload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(firstReload).toHaveFocus();

      fireEvent.click(firstReload);
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
      const secondReload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(secondReload).not.toBe(firstReload);
      expect(secondReload).toHaveFocus();

      fireEvent.click(secondReload);
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(3));
      const thirdReload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(thirdReload).not.toBe(secondReload);
      expect(thirdReload).toHaveFocus();
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test('refocuses Reload after a generic reload failure but does not focus an initial background failure', async () => {
      const initialLoad = deferred<typeof DEFAULT_PROFILE>();
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockReturnValueOnce(initialLoad.promise)
        .mockRejectedValueOnce(new Error('synthetic private generic reload detail'));
      const view = render(
        <>
          <button type="button">Outside control</button>
          <MemberDirectoryProfile
            app={app}
            uid="synthetic-user"
            displayName="Synthetic Member"
            backendAvailable
          />
        </>,
      );
      const outside = screen.getByRole('button', { name: 'Outside control' });
      outside.focus();
      expect(outside).toHaveFocus();

      await act(async () => initialLoad.reject(new Error('synthetic private initial detail')));

      const initialReload = await screen.findByRole('button', { name: 'Reload settings' });
      expect(outside).toHaveFocus();
      expect(initialReload).not.toHaveFocus();
      initialReload.focus();
      fireEvent.click(initialReload);

      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
      const replacementReload = await screen.findByRole('button', {
        name: 'Reload settings',
      });
      expect(replacementReload).not.toBe(initialReload);
      expect(replacementReload).toHaveFocus();
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('synthetic private');
      view.unmount();
    });

    test('clears recovery focus intent after a successful authoritative reload', async () => {
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private initial detail'))
        .mockResolvedValueOnce(PROFILE_WITH_PHOTO);
      renderProfile();
      const reload = await screen.findByRole('button', { name: 'Reload settings' });
      reload.focus();

      fireEvent.click(reload);

      expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
        .toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reload settings' }))
        .not.toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);
      expect(screen.getByRole('checkbox')).not.toHaveFocus();
      expect(screen.getByLabelText('Replace profile photo')).not.toHaveFocus();
      expect(screen.getByRole('button', { name: 'Remove current saved photo' }))
        .not.toHaveFocus();
      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryVisibility).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    });

    test.each([
      ['application', otherApp, 'synthetic-user'],
      ['account', app, 'other-synthetic-user'],
    ])('makes a failed old Reload focus-inert after the %s changes', async (
      _label,
      nextApp,
      nextUid,
    ) => {
      const oldReload = deferred<typeof DEFAULT_PROFILE>();
      (setMyMemberDirectoryVisibility as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockReturnValueOnce(oldReload.promise)
        .mockResolvedValueOnce(DEFAULT_PROFILE);
      const view = renderProfile();
      fireEvent.click(await screen.findByRole('checkbox'));
      fireEvent.click(await screen.findByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));

      view.rerender(
        <MemberDirectoryProfile
          app={nextApp}
          uid={nextUid}
          displayName="Current Synthetic Member"
          backendAvailable
        />,
      );
      const currentInput = await screen.findByLabelText('Add profile photo');
      currentInput.focus();
      await act(async () => oldReload.reject(new Error('synthetic private late detail')));

      expect(currentInput).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Reload settings' }))
        .not.toBeInTheDocument();
      expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent('synthetic private');
    });

    test('makes a failed old Reload focus-inert after unmount', async () => {
      const oldReload = deferred<typeof DEFAULT_PROFILE>();
      (setMyMemberDirectoryVisibility as jest.Mock)
        .mockRejectedValueOnce(new Error('synthetic private outcome detail'));
      (getMyMemberDirectoryProfile as jest.Mock)
        .mockResolvedValueOnce(DEFAULT_PROFILE)
        .mockReturnValueOnce(oldReload.promise);
      const view = renderProfile();
      fireEvent.click(await screen.findByRole('checkbox'));
      fireEvent.click(await screen.findByRole('button', { name: 'Reload settings' }));
      await waitFor(() => expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2));
      view.unmount();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        outside.focus();

        await act(async () => oldReload.reject(new Error('synthetic private late detail')));

        expect(outside).toHaveFocus();
        expect(createMemberDirectoryRequestId).toHaveBeenCalledTimes(1);
        expect(setMyMemberDirectoryVisibility).toHaveBeenCalledTimes(1);
        expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
        expect(removeMyMemberDirectoryPhoto).not.toHaveBeenCalled();
      } finally {
        outside.remove();
      }
    });
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
        displayName="Other Synthetic Member"
        backendAvailable
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
        displayName="Other Synthetic Member"
        backendAvailable
      />,
    );
    expect(await screen.findByRole('img', { name: 'Your current profile thumbnail' }))
      .toBeInTheDocument();
    await act(async () => oldMutation.resolve({}));

    expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.queryByText('Officer finder is on.')).not.toBeInTheDocument();
  });

  test.each([
    ['application', otherApp, 'synthetic-user'],
    ['account', app, 'other-synthetic-user'],
  ])(
    'MEMBERS-DIRECTORY-001F makes a deferred file read inert after the %s changes',
    async (_label, nextApp, nextUid) => {
      const deferredReader = installDeferredFileReader();

      try {
        (getMyMemberDirectoryProfile as jest.Mock)
          .mockResolvedValueOnce(DEFAULT_PROFILE)
          .mockResolvedValueOnce(PROFILE_WITH_PHOTO);
        const view = renderProfile();
        const input = await screen.findByLabelText('Add profile photo');

        fireEvent.change(input, {
          target: {
            files: [new File(
              ['deferred synthetic pixels'],
              'fixture-025.png',
              { type: 'image/png' },
            )],
          },
        });
        expect(await screen.findByRole('status')).toHaveTextContent(
          'Preparing selected photo preview...',
        );
        expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();

        view.rerender(
          <MemberDirectoryProfile
            app={nextApp}
            uid={nextUid}
            displayName="Current Synthetic Member"
            backendAvailable
          />,
        );
        expect(await screen.findByRole('img', {
          name: 'Your current profile thumbnail',
        })).toBeInTheDocument();

        await act(async () => deferredReader.readers[0].complete(
          'deferred synthetic pixels',
        ));

        expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
        expect(getMyMemberDirectoryProfile).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('img', { name: 'Your current profile thumbnail' }))
          .toHaveAttribute('src', `data:image/webp;base64,${PHOTO.base64Data}`);
        expect(screen.getByRole('checkbox')).toBeChecked();
        expect(screen.queryByText('Profile photo saved.')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } finally {
        deferredReader.restore();
      }
    },
  );

  test('MEMBERS-DIRECTORY-001F makes a deferred file read inert after unmount', async () => {
    const deferredReader = installDeferredFileReader();
    try {
      const view = renderProfile();
      const input = await screen.findByLabelText('Add profile photo');
      fireEvent.change(input, {
        target: {
          files: [new File(['late unmounted bytes'], 'fixture-026.png', {
            type: 'image/png',
          })],
        },
      });
      expect(screen.getByRole('button', { name: 'Cancel selected photo' }))
        .toBeEnabled();

      view.unmount();
      await act(async () => deferredReader.readers[0].complete('late unmounted bytes'));

      expect(createMemberDirectoryRequestId).not.toHaveBeenCalled();
      expect(setMyMemberDirectoryPhoto).not.toHaveBeenCalled();
    } finally {
      deferredReader.restore();
    }
  });

  test('MEMBERS-DIRECTORY-001F ignores stale preview load and error events after reselection', async () => {
    renderProfile();
    const input = await screen.findByLabelText('Add profile photo');
    fireEvent.change(input, {
      target: {
        files: [new File(['old render bytes'], 'fixture-027.png', { type: 'image/png' })],
      },
    });
    const oldPreview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    fireEvent.change(input, {
      target: {
        files: [new File(['new render bytes'], 'fixture-028.webp', { type: 'image/webp' })],
      },
    });
    const newPreview = await screen.findByRole('img', {
      name: 'Selected profile photo preview',
    });
    expect(newPreview).toHaveAttribute(
      'src',
      `data:image/webp;base64,${btoa('new render bytes')}`,
    );

    fireEvent.load(oldPreview);
    fireEvent.error(oldPreview);

    expect(screen.getByRole('img', { name: 'Selected profile photo preview' }))
      .toHaveAttribute('src', `data:image/webp;base64,${btoa('new render bytes')}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeDisabled();
    fireEvent.load(newPreview);
    expect(screen.getByRole('button', { name: 'Save profile photo' })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: 'Remove current saved photo' })).toBeEnabled();
  });

  test('MEMBERS-DIRECTORY-001F keeps the photo review contained at 320px', () => {
    const css = readFileSync(join(__dirname, 'Account.css'), 'utf8');

    expect(css).toMatch(/\.member-directory-profile h2\s*\{[\s\S]*color:\s*#111827;/);
    expect(css).toMatch(
      /\.member-directory-profile__photo-actions,\s*\.member-directory-profile__photo-actions input\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__controls\s*\{[\s\S]*min-width:\s*0;[\s\S]*align-items:\s*stretch;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__photo\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__photo-actions\s*\{[\s\S]*flex:\s*1 1 15rem;[\s\S]*width:\s*100%;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__photo-actions input\[type='file'\]\s*\{[\s\S]*width:\s*100%;[\s\S]*min-height:\s*2\.75rem;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__draft\s*\{[\s\S]*min-width:\s*0;[\s\S]*margin:\s*0;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__visibility label\s*\{[\s\S]*min-height:\s*2\.75rem;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__draft\s*\{[\s\S]*min-width:\s*0;[\s\S]*color:\s*#111827;[\s\S]*background:\s*#eff6ff;[\s\S]*border:\s*2px solid #1e40af;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__draft-image\s*\{[\s\S]*width:\s*8rem;[\s\S]*height:\s*8rem;[\s\S]*max-width:\s*100%;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile__draft-image\s*\{[\s\S]*object-fit:\s*cover;[\s\S]*object-position:\s*center;/,
    );
    expect(css).toMatch(
      /\.member-directory-profile button\s*\{[\s\S]*min-height:\s*2\.75rem;/,
    );
    expect(css).toMatch(/@media \(max-width:\s*359px\)/);
    expect(css).toMatch(
      /@media \(max-width:\s*359px\)[\s\S]*\.member-directory-profile__draft-actions,\s*\.member-directory-profile__draft-actions button\s*\{[\s\S]*width:\s*100%;/,
    );
  });
});
