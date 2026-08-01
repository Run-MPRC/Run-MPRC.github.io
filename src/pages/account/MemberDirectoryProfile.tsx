import { FirebaseApp } from 'firebase/app';
import React, { useEffect, useRef, useState } from 'react';
import {
  createMemberDirectoryRequestId,
  getMyMemberDirectoryProfile,
  isDefinitiveMemberDirectoryRejection,
  MemberDirectoryProfile as MemberDirectoryProfileData,
  MEMBER_DIRECTORY_UPLOAD_TYPES,
  MemberDirectoryUploadType,
  removeMyMemberDirectoryPhoto,
  setMyMemberDirectoryPhoto,
  setMyMemberDirectoryVisibility,
} from '../../services/account/memberDirectoryService';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const LOAD_FAILURE_MESSAGE = 'We could not load your profile photo and officer finder settings. No setting was changed. Reload settings to try again.';
const UNKNOWN_CHANGE_MESSAGE = 'We could not confirm that change. Do not make another change yet. Reload settings to check what is currently saved.';
const REJECTED_CHANGE_MESSAGE = 'That change was rejected before it was saved. Review the requirements and try again.';
const REQUEST_UNAVAILABLE_MESSAGE = 'This browser could not safely start that change. No setting was changed. Reload the page and try again.';

const appIdentities = new WeakMap<object, number>();
let nextAppIdentity = 1;

function appIdentity(app: object): number {
  const existing = appIdentities.get(app);
  if (existing !== undefined) return existing;
  const identity = nextAppIdentity;
  nextAppIdentity += 1;
  appIdentities.set(app, identity);
  return identity;
}

type ReadyState = {
  phase: 'ready';
  profile: MemberDirectoryProfileData;
  confirmation: string | null;
};

type ViewState =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'unknown' }
  | ReadyState
  | {
    phase: 'pending';
    profile: MemberDirectoryProfileData;
    action: 'visibility' | 'upload' | 'remove';
  };

type MutationStart = {
  lifetime: symbol;
  operation: symbol;
  profile: MemberDirectoryProfileData;
};

type MutationConfirmation = (
  profile: MemberDirectoryProfileData,
) => string;

function visibilityConfirmation(
  requested: boolean,
): MutationConfirmation {
  return (profile) => {
    if (profile.searchableByOfficers === requested) {
      return requested ? 'Officer finder is on.' : 'Officer finder is off.';
    }
    return `Officer finder changed again elsewhere. It is currently ${
      profile.searchableByOfficers ? 'on' : 'off'
    }.`;
  };
}

function uploadConfirmation(requestId: string): MutationConfirmation {
  return (profile) => {
    if (profile.photo?.version === requestId) {
      return 'Profile photo saved. Your officer finder setting did not change.';
    }
    return profile.hasPhoto
      ? 'Profile photo changed again elsewhere. The preview shows the current photo.'
      : 'Profile photo changed again elsewhere. No profile photo is currently saved.';
  };
}

const removeConfirmation: MutationConfirmation = (profile) => (
  profile.hasPhoto
    ? 'Profile photo changed again elsewhere. The preview shows the current photo.'
    : 'Profile photo removed. Your officer finder setting did not change.'
);

function isAcceptedUploadType(value: string): value is MemberDirectoryUploadType {
  return MEMBER_DIRECTORY_UPLOAD_TYPES.some((type) => type === value);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('unavailable'));
    reader.onabort = () => reject(new Error('unavailable'));
    reader.onload = () => {
      const { result } = reader;
      const prefix = `data:${file.type};base64,`;
      if (typeof result !== 'string' || !result.startsWith(prefix)) {
        reject(new Error('unavailable'));
        return;
      }
      resolve(result.slice(prefix.length));
    };
    reader.readAsDataURL(file);
  });
}

function MemberDirectoryProfileAttempt({
  app,
  uid,
  hasDisplayName,
}: {
  app: FirebaseApp;
  uid: string;
  hasDisplayName: boolean;
}) {
  const [state, setState] = useState<ViewState>({ phase: 'loading' });
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const lifetimeRef = useRef<symbol | null>(null);
  const loadRef = useRef<symbol | null>(null);
  const mutationRef = useRef<symbol | null>(null);

  useEffect(() => {
    const lifetime = Symbol('member-directory-lifetime');
    lifetimeRef.current = lifetime;
    return () => {
      if (lifetimeRef.current === lifetime) lifetimeRef.current = null;
      loadRef.current = null;
      mutationRef.current = null;
    };
  }, []);

  useEffect(() => {
    const lifetime = lifetimeRef.current;
    const load = Symbol('member-directory-load');
    let active = true;
    loadRef.current = load;
    mutationRef.current = null;
    setFileError(null);
    setState({ phase: 'loading' });

    async function loadProfile() {
      try {
        const profile = await getMyMemberDirectoryProfile(app);
        if (
          !active
          || lifetime === null
          || lifetimeRef.current !== lifetime
          || loadRef.current !== load
        ) return;
        setState({ phase: 'ready', profile, confirmation: null });
      } catch {
        if (
          !active
          || lifetime === null
          || lifetimeRef.current !== lifetime
          || loadRef.current !== load
        ) return;
        setState({ phase: 'unavailable' });
      }
    }

    loadProfile();
    return () => {
      active = false;
      if (loadRef.current === load) loadRef.current = null;
    };
  }, [app, uid, reloadAttempt]);

  function startMutation(
    action: 'visibility' | 'upload' | 'remove',
  ): MutationStart | null {
    if (
      state.phase !== 'ready'
      || lifetimeRef.current === null
      || mutationRef.current !== null
    ) return null;
    const operation = Symbol(`member-directory-${action}`);
    const start = {
      lifetime: lifetimeRef.current,
      operation,
      profile: state.profile,
    };
    mutationRef.current = operation;
    setFileError(null);
    setState({ phase: 'pending', profile: state.profile, action });
    return start;
  }

  function mutationIsCurrent(start: MutationStart): boolean {
    return lifetimeRef.current === start.lifetime
      && mutationRef.current === start.operation;
  }

  async function finishMutation(
    start: MutationStart,
    mutate: () => Promise<unknown>,
    confirmation: MutationConfirmation,
  ) {
    try {
      await mutate();
      if (!mutationIsCurrent(start)) return;
      const profile = await getMyMemberDirectoryProfile(app);
      if (!mutationIsCurrent(start)) return;
      mutationRef.current = null;
      setState({ phase: 'ready', profile, confirmation: confirmation(profile) });
    } catch (error) {
      if (!mutationIsCurrent(start)) return;
      if (isDefinitiveMemberDirectoryRejection(error)) {
        try {
          const profile = await getMyMemberDirectoryProfile(app);
          if (!mutationIsCurrent(start)) return;
          mutationRef.current = null;
          setState({ phase: 'ready', profile, confirmation: null });
          setFileError(REJECTED_CHANGE_MESSAGE);
        } catch {
          if (!mutationIsCurrent(start)) return;
          mutationRef.current = null;
          setFileError(null);
          setState({ phase: 'unavailable' });
        }
        return;
      }
      mutationRef.current = null;
      setFileError(null);
      setState({ phase: 'unknown' });
    }
  }

  function handleVisibilityChange(event: React.ChangeEvent<HTMLInputElement>) {
    const searchableByOfficers = event.currentTarget.checked;
    let requestId: string;
    try {
      requestId = createMemberDirectoryRequestId();
    } catch {
      setFileError(REQUEST_UNAVAILABLE_MESSAGE);
      return;
    }
    const start = startMutation('visibility');
    if (start === null) return;
    finishMutation(
      start,
      () => setMyMemberDirectoryVisibility(app, {
        requestId,
        expectedRevision: start.profile.revision,
        searchableByOfficers,
      }),
      visibilityConfirmation(searchableByOfficers),
    );
  }

  function handleRemovePhoto() {
    let requestId: string;
    try {
      requestId = createMemberDirectoryRequestId();
    } catch {
      setFileError(REQUEST_UNAVAILABLE_MESSAGE);
      return;
    }
    const start = startMutation('remove');
    if (start === null) return;
    finishMutation(
      start,
      () => removeMyMemberDirectoryPhoto(app, {
        requestId,
        expectedRevision: start.profile.revision,
      }),
      removeConfirmation,
    );
  }

  async function handlePhotoSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;
    input.value = '';
    setFileError(null);
    if (file === null) return;
    const { type: contentType } = file;
    if (!isAcceptedUploadType(contentType)) {
      setFileError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      setFileError('Choose a non-empty image that is 2 MiB or smaller.');
      return;
    }

    let requestId: string;
    try {
      requestId = createMemberDirectoryRequestId();
    } catch {
      setFileError(REQUEST_UNAVAILABLE_MESSAGE);
      return;
    }

    const start = startMutation('upload');
    if (start === null) return;
    let base64Data: string;
    try {
      base64Data = await readFileAsBase64(file);
    } catch {
      if (!mutationIsCurrent(start)) return;
      mutationRef.current = null;
      setState({ phase: 'ready', profile: start.profile, confirmation: null });
      setFileError('We could not read that image. Choose the file again.');
      return;
    }
    if (!mutationIsCurrent(start)) return;

    finishMutation(
      start,
      () => setMyMemberDirectoryPhoto(app, {
        requestId,
        expectedRevision: start.profile.revision,
        contentType,
        base64Data,
      }),
      uploadConfirmation(requestId),
    );
  }

  function reloadSettings() {
    if (state.phase !== 'unknown' && state.phase !== 'unavailable') return;
    setReloadAttempt((attempt) => attempt + 1);
  }

  return (
    <section
      className="member-directory-profile"
      aria-labelledby="member-directory-profile-heading"
      aria-busy={state.phase === 'loading' || state.phase === 'pending'}
    >
      <h2 id="member-directory-profile-heading">Profile photo and officer finder</h2>
      <p>
        You can add an optional profile photo. Uploading, replacing, or removing it
        does not turn on the officer finder.
      </p>
      <p id="member-directory-privacy-description">
        If you turn on the officer finder, verified website administrators can search
        for your name and see your thumbnail, if you added one. Turning it off prevents
        later searches ordered after the change from returning you, but an earlier
        completed search cannot be recalled and its response may arrive afterward. Your
        private thumbnail stays stored until you remove it. This feature does not use
        facial recognition or image matching. A search result does not prove current
        club membership, payment, or eligibility.
      </p>

      {state.phase === 'loading' && (
        <p role="status" aria-live="polite">Loading photo settings...</p>
      )}

      {(state.phase === 'unavailable' || state.phase === 'unknown') && (
        <div className="member-directory-profile__warning">
          <p role="alert" aria-live="assertive" aria-atomic="true">
            {state.phase === 'unknown' ? UNKNOWN_CHANGE_MESSAGE : LOAD_FAILURE_MESSAGE}
          </p>
          <button type="button" onClick={reloadSettings}>
            Reload settings
          </button>
        </div>
      )}

      {(state.phase === 'ready' || state.phase === 'pending') && (() => {
        const { profile } = state;
        const pending = state.phase === 'pending';
        const finderNeedsName = !hasDisplayName && !profile.searchableByOfficers;
        const finderHiddenWithoutName = !hasDisplayName && profile.searchableByOfficers;
        let pendingMessage = '';
        if (state.phase === 'pending') {
          if (state.action === 'upload') pendingMessage = 'Saving profile photo...';
          else if (state.action === 'remove') pendingMessage = 'Removing profile photo...';
          else pendingMessage = 'Saving officer finder setting...';
        }
        return (
          <div className="member-directory-profile__controls">
            <div className="member-directory-profile__photo">
              {profile.photo ? (
                <img
                  src={`data:${profile.photo.contentType};base64,${profile.photo.base64Data}`}
                  width={128}
                  height={128}
                  alt="Your current profile thumbnail"
                />
              ) : (
                <div className="member-directory-profile__placeholder" aria-label="No profile photo">
                  No photo
                </div>
              )}
              <div className="member-directory-profile__photo-actions">
                <label htmlFor="member-directory-photo-file">
                  {profile.hasPhoto ? 'Replace profile photo' : 'Add profile photo'}
                </label>
                <input
                  id="member-directory-photo-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoSelection}
                  disabled={pending}
                  aria-describedby="member-directory-file-help member-directory-privacy-description"
                />
                <span id="member-directory-file-help">
                  JPG, PNG, or WebP. Maximum 2 MiB. The saved thumbnail is processed
                  to remove image metadata; the original upload is not saved.
                </span>
                {profile.hasPhoto && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    disabled={pending}
                  >
                    Remove profile photo
                  </button>
                )}
              </div>
            </div>

            <div className="member-directory-profile__visibility">
              <label htmlFor="member-directory-searchable">
                <input
                  id="member-directory-searchable"
                  type="checkbox"
                  checked={profile.searchableByOfficers}
                  onChange={handleVisibilityChange}
                  disabled={pending || finderNeedsName}
                  aria-describedby={[
                    'member-directory-privacy-description',
                    !hasDisplayName ? 'member-directory-name-required' : null,
                  ].filter(Boolean).join(' ')}
                />
                Let verified website administrators find me by name
              </label>
              {finderNeedsName && (
                <p id="member-directory-name-required">
                  Add your full name in the Profile section before turning this on.
                </p>
              )}
              {finderHiddenWithoutName && (
                <p id="member-directory-name-required">
                  This setting is on, but officers cannot find you until you add a
                  full name in the Profile section. You can still turn the setting off.
                </p>
              )}
            </div>

            {fileError && (
              <p role="alert" aria-live="assertive" aria-atomic="true">
                {fileError}
              </p>
            )}
            {pendingMessage && (
              <p role="status" aria-live="polite" aria-atomic="true">
                {pendingMessage}
              </p>
            )}
            {state.phase === 'ready' && state.confirmation && (
              <p role="status" aria-live="polite" aria-atomic="true">
                {state.confirmation}
              </p>
            )}
          </div>
        );
      })()}
    </section>
  );
}

export default function MemberDirectoryProfile({
  app,
  uid,
  hasDisplayName,
}: {
  app: FirebaseApp;
  uid: string;
  hasDisplayName: boolean;
}) {
  return (
    <MemberDirectoryProfileAttempt
      key={`${appIdentity(app)}:${uid}`}
      app={app}
      uid={uid}
      hasDisplayName={hasDisplayName}
    />
  );
}
