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
    expect(screen.queryByRole('button', { name: 'Remove profile photo' }))
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
    expect(await screen.findByRole('img', { name: 'No profile photo' }))
      .toBeInTheDocument();
    expect(screen.getByRole('checkbox', {
      name: 'Let verified website administrators find me by name',
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
    expect(screen.getByRole('button', { name: 'Remove profile photo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox'));

    const reset = await screen.findByRole('img', {
      name: 'Your current profile thumbnail',
    });
    expect(reset).toHaveAttribute(
      'src',
      `data:image/webp;base64,${newPhoto.base64Data}`,
    );
    expect(screen.getByRole('button', { name: 'Remove profile photo' })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: 'Remove profile photo' })).toBeEnabled();
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
