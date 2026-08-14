import { FirebaseApp } from 'firebase/app';
import React, { useEffect, useRef, useState } from 'react';
import MEMBER_DIRECTORY_BACKEND_AVAILABLE from '../../services/account/memberDirectoryAvailability';
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
const MAX_DISPLAY_NAME_CODE_UNITS = 200;
const MIN_CANONICAL_DISPLAY_NAME_CODE_UNITS = 2;
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]/u;
const DIRECTORY_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const LOAD_FAILURE_MESSAGE = 'We could not load your profile photo and officer finder settings. Reload settings to try again.';
const UNKNOWN_CHANGE_MESSAGE = 'We could not confirm that change. Do not make another change yet. Reload settings to check what is currently saved.';
const REJECTED_CHANGE_MESSAGE = 'That change was rejected before it was saved. Review the requirements and try again.';
const REQUEST_UNAVAILABLE_MESSAGE = 'This browser could not safely start that change. No setting was changed. Reload the page and try again.';

function hasForbiddenDisplayNameUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return CONTROL_OR_FORMAT_PATTERN.test(value);
}

export function isMemberDirectoryDisplayNameEligible(value: unknown): boolean {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DISPLAY_NAME_CODE_UNITS
    || hasForbiddenDisplayNameUnicode(value)
  ) return false;

  try {
    const displayName = value.trim();
    if (
      displayName.length === 0
      || displayName.length > MAX_DISPLAY_NAME_CODE_UNITS
    ) return false;
    const tokens = displayName
      .normalize('NFKC')
      .toLowerCase()
      .match(DIRECTORY_TOKEN_PATTERN);
    if (tokens === null) return false;
    const canonical = tokens.join(' ');
    return canonical.length >= MIN_CANONICAL_DISPLAY_NAME_CODE_UNITS
      && canonical.length <= MAX_DISPLAY_NAME_CODE_UNITS;
  } catch {
    return false;
  }
}

function MemberDirectoryProfilePreview({
  displayNameEligible,
}: {
  displayNameEligible: boolean;
}) {
  return (
    <section
      className="member-directory-profile"
      aria-labelledby="member-directory-profile-heading"
    >
      <h2 id="member-directory-profile-heading">Profile photo and officer finder</h2>
      <div
        id="member-directory-preview-status"
        className="member-directory-profile__preview"
        role="status"
      >
        <strong>Interface preview — not connected yet.</strong>
        <span>
          No photo or finder setting is read, uploaded, searched, or saved from
          this preview.
        </span>
      </div>
      <p>
        When connected, you will be able to add an optional profile photo.
        Uploading, replacing, or removing it will not turn on the officer finder.
      </p>
      <p id="member-directory-privacy-description">
        When connected, authorized officers will be able to search by name and
        see a voluntary thumbnail only after you turn on the separate finder
        choice. A result will not prove current club membership, payment, or
        eligibility. The finder will not accept a photo as a query or use facial
        recognition or image matching.
      </p>

      <div className="member-directory-profile__controls">
        <div className="member-directory-profile__photo">
          <div
            className="member-directory-profile__placeholder"
            role="img"
            aria-label="Profile photo preview"
          >
            Photo preview
          </div>
          <div className="member-directory-profile__photo-actions">
            <span
              id="member-directory-photo-file-label-preview"
              className="member-directory-profile__control-label"
            >
              Add profile photo (not available yet)
            </span>
            <input
              id="member-directory-photo-file-preview"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled
              aria-labelledby="member-directory-photo-file-label-preview"
              aria-describedby="member-directory-preview-status member-directory-file-help-preview member-directory-privacy-description"
            />
            <span id="member-directory-file-help-preview">
              JPG, PNG, or WebP up to 2 MiB will be supported after the protected
              backend is connected.
            </span>
          </div>
        </div>

        <div className="member-directory-profile__visibility">
          <label htmlFor="member-directory-searchable-preview">
            <input
              id="member-directory-searchable-preview"
              type="checkbox"
              checked={false}
              disabled
              readOnly
              aria-describedby={[
                'member-directory-preview-status',
                'member-directory-privacy-description',
                !displayNameEligible
                  ? 'member-directory-name-required-preview'
                  : null,
              ].filter(Boolean).join(' ')}
            />
            Let authorized officers find me by name (not available yet)
          </label>
          {!displayNameEligible && (
            <p id="member-directory-name-required-preview">
              An eligible name in the Profile section will also be required when
              the finder is connected. It must remain within the 200-character
              limit after normalization, produce searchable name text at least two
              characters long, and contain no control or format characters.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

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
  action: 'visibility' | 'upload' | 'remove';
};

type ActionError = {
  control: 'visibility' | 'file' | 'remove';
  invalid: boolean;
  message: string;
};

type PhotoDraft =
  | {
    phase: 'reading';
    identity: symbol;
  }
  | {
    phase: 'preview';
    identity: symbol;
    contentType: MemberDirectoryUploadType;
    base64Data: string;
    dataUrl: string;
    renderState: 'loading' | 'ready';
  };

type MutationConfirmation = (
  profile: MemberDirectoryProfileData,
) => string;

type RecoveryFocusIntent = {
  lifetime: symbol;
  source: 'mutation' | 'reload';
  load: symbol | null;
};

type RemoveFocusIntent = {
  lifetime: symbol;
  operation: symbol;
};

type ConfirmedPhotoFocusIntent = {
  lifetime: symbol;
  operation: symbol;
  action: 'upload' | 'remove';
};

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

function SavedMemberDirectoryPhoto({
  photo,
}: {
  photo: NonNullable<MemberDirectoryProfileData['photo']>;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="member-directory-profile__placeholder"
        role="img"
        aria-label="Saved profile photo could not be displayed"
      >
        Photo unavailable
      </div>
    );
  }

  return (
    <img
      src={`data:${photo.contentType};base64,${photo.base64Data}`}
      width={128}
      height={128}
      alt="Your current profile thumbnail"
      onError={() => setFailed(true)}
    />
  );
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
  displayNameEligible,
}: {
  app: FirebaseApp;
  uid: string;
  displayNameEligible: boolean;
}) {
  const [state, setState] = useState<ViewState>({ phase: 'loading' });
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null>(null);
  const lifetimeRef = useRef<symbol | null>(null);
  const loadRef = useRef<symbol | null>(null);
  const mutationRef = useRef<symbol | null>(null);
  const uncertainChangeRef = useRef(false);
  const recoveryFocusIntentRef = useRef<RecoveryFocusIntent | null>(null);
  const pendingRemoveFocusIntentRef = useRef<RemoveFocusIntent | null>(null);
  const rejectedRemoveResultFocusIntentRef = useRef<RemoveFocusIntent | null>(null);
  const pendingConfirmedPhotoFocusIntentRef = useRef<ConfirmedPhotoFocusIntent | null>(null);
  const confirmedPhotoResultFocusIntentRef = useRef<ConfirmedPhotoFocusIntent | null>(null);
  const photoReadRef = useRef<symbol | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const removePhotoButtonRef = useRef<HTMLButtonElement | null>(null);
  const reloadButtonRef = useRef<HTMLButtonElement | null>(null);
  const savePhotoButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const lifetime = Symbol('member-directory-lifetime');
    lifetimeRef.current = lifetime;
    return () => {
      if (lifetimeRef.current === lifetime) lifetimeRef.current = null;
      loadRef.current = null;
      mutationRef.current = null;
      uncertainChangeRef.current = false;
      recoveryFocusIntentRef.current = null;
      pendingRemoveFocusIntentRef.current = null;
      rejectedRemoveResultFocusIntentRef.current = null;
      pendingConfirmedPhotoFocusIntentRef.current = null;
      confirmedPhotoResultFocusIntentRef.current = null;
      photoReadRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state.phase !== 'unknown' && state.phase !== 'unavailable') return;
    const intent = recoveryFocusIntentRef.current;
    if (
      intent === null
      || intent.lifetime !== lifetimeRef.current
      || (intent.source === 'reload'
        && (intent.load === null || intent.load !== loadRef.current))
    ) return;
    const target = reloadButtonRef.current;
    if (target === null) return;
    recoveryFocusIntentRef.current = null;
    target.focus();
  }, [state.phase]);

  useEffect(() => {
    const intent = rejectedRemoveResultFocusIntentRef.current;
    if (state.phase !== 'ready' || intent === null) return;
    rejectedRemoveResultFocusIntentRef.current = null;
    if (intent.lifetime !== lifetimeRef.current) return;

    let target: HTMLElement | null = null;
    if (state.profile.hasPhoto) {
      target = removePhotoButtonRef.current;
    } else if (
      photoDraft?.phase === 'preview'
      && photoDraft.renderState === 'ready'
      && photoReadRef.current === photoDraft.identity
    ) {
      target = savePhotoButtonRef.current;
    } else {
      target = photoInputRef.current;
    }
    if (target === null) return;

    const active = document.activeElement;
    if (active === target) return;
    if (
      active === null
      || active === document.body
      || active === document.documentElement
      || !active.isConnected
    ) target.focus();
  }, [photoDraft, state]);

  useEffect(() => {
    const intent = confirmedPhotoResultFocusIntentRef.current;
    if (state.phase !== 'ready' || intent === null) return;
    confirmedPhotoResultFocusIntentRef.current = null;
    if (intent.lifetime !== lifetimeRef.current) return;

    let target: HTMLElement | null = null;
    if (intent.action === 'upload') {
      target = photoInputRef.current;
    } else if (state.profile.hasPhoto) {
      target = removePhotoButtonRef.current;
    } else if (
      photoDraft?.phase === 'preview'
      && photoDraft.renderState === 'ready'
      && photoReadRef.current === photoDraft.identity
    ) {
      target = savePhotoButtonRef.current;
    } else {
      target = photoInputRef.current;
    }
    if (target === null) return;

    const active = document.activeElement;
    if (active === target) return;
    if (
      active === null
      || active === document.body
      || active === document.documentElement
      || !active.isConnected
    ) target.focus();
  }, [photoDraft, state]);

  useEffect(() => {
    const lifetime = lifetimeRef.current;
    const load = Symbol('member-directory-load');
    const preserveUncertainChange = uncertainChangeRef.current;
    let active = true;
    loadRef.current = load;
    const focusIntent = recoveryFocusIntentRef.current;
    if (
      focusIntent !== null
      && focusIntent.lifetime === lifetime
      && focusIntent.source === 'reload'
      && focusIntent.load === null
    ) {
      recoveryFocusIntentRef.current = { ...focusIntent, load };
    }
    mutationRef.current = null;
    pendingRemoveFocusIntentRef.current = null;
    rejectedRemoveResultFocusIntentRef.current = null;
    pendingConfirmedPhotoFocusIntentRef.current = null;
    confirmedPhotoResultFocusIntentRef.current = null;
    photoReadRef.current = null;
    setActionError(null);
    setPhotoDraft(null);
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
        uncertainChangeRef.current = false;
        recoveryFocusIntentRef.current = null;
        setState({ phase: 'ready', profile, confirmation: null });
      } catch {
        if (
          !active
          || lifetime === null
          || lifetimeRef.current !== lifetime
          || loadRef.current !== load
        ) return;
        setState({
          phase: preserveUncertainChange ? 'unknown' : 'unavailable',
        });
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
      action,
    };
    mutationRef.current = operation;
    setActionError(null);
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
    } catch (error) {
      if (!mutationIsCurrent(start)) return;
      if (isDefinitiveMemberDirectoryRejection(error)) {
        pendingConfirmedPhotoFocusIntentRef.current = null;
        confirmedPhotoResultFocusIntentRef.current = null;
        try {
          const profile = await getMyMemberDirectoryProfile(app);
          if (!mutationIsCurrent(start)) return;
          const focusIntent = pendingRemoveFocusIntentRef.current;
          pendingRemoveFocusIntentRef.current = null;
          rejectedRemoveResultFocusIntentRef.current = focusIntent !== null
            && focusIntent.lifetime === start.lifetime
            && focusIntent.operation === start.operation
            ? focusIntent
            : null;
          mutationRef.current = null;
          uncertainChangeRef.current = false;
          recoveryFocusIntentRef.current = null;
          setState({ phase: 'ready', profile, confirmation: null });
          setActionError({
            control: start.action === 'upload' ? 'file' : start.action,
            invalid: false,
            message: REJECTED_CHANGE_MESSAGE,
          });
        } catch {
          if (!mutationIsCurrent(start)) return;
          mutationRef.current = null;
          pendingRemoveFocusIntentRef.current = null;
          rejectedRemoveResultFocusIntentRef.current = null;
          pendingConfirmedPhotoFocusIntentRef.current = null;
          confirmedPhotoResultFocusIntentRef.current = null;
          photoReadRef.current = null;
          setPhotoDraft(null);
          setActionError(null);
          recoveryFocusIntentRef.current = {
            lifetime: start.lifetime,
            source: 'mutation',
            load: null,
          };
          setState({ phase: 'unavailable' });
        }
        return;
      }
      mutationRef.current = null;
      pendingRemoveFocusIntentRef.current = null;
      rejectedRemoveResultFocusIntentRef.current = null;
      pendingConfirmedPhotoFocusIntentRef.current = null;
      confirmedPhotoResultFocusIntentRef.current = null;
      photoReadRef.current = null;
      setPhotoDraft(null);
      setActionError(null);
      uncertainChangeRef.current = true;
      recoveryFocusIntentRef.current = {
        lifetime: start.lifetime,
        source: 'mutation',
        load: null,
      };
      setState({ phase: 'unknown' });
      return;
    }

    if (!mutationIsCurrent(start)) return;
    pendingRemoveFocusIntentRef.current = null;
    rejectedRemoveResultFocusIntentRef.current = null;
    confirmedPhotoResultFocusIntentRef.current = null;
    try {
      const profile = await getMyMemberDirectoryProfile(app);
      if (!mutationIsCurrent(start)) return;
      const focusIntent = pendingConfirmedPhotoFocusIntentRef.current;
      pendingConfirmedPhotoFocusIntentRef.current = null;
      confirmedPhotoResultFocusIntentRef.current = focusIntent !== null
        && focusIntent.lifetime === start.lifetime
        && focusIntent.operation === start.operation
        && focusIntent.action === start.action
        && (start.action === 'upload' || start.action === 'remove')
        ? focusIntent
        : null;
      mutationRef.current = null;
      if (start.action === 'upload') {
        photoReadRef.current = null;
        setPhotoDraft(null);
      }
      uncertainChangeRef.current = false;
      recoveryFocusIntentRef.current = null;
      setState({ phase: 'ready', profile, confirmation: confirmation(profile) });
    } catch {
      if (!mutationIsCurrent(start)) return;
      mutationRef.current = null;
      pendingConfirmedPhotoFocusIntentRef.current = null;
      confirmedPhotoResultFocusIntentRef.current = null;
      photoReadRef.current = null;
      setPhotoDraft(null);
      setActionError(null);
      uncertainChangeRef.current = true;
      recoveryFocusIntentRef.current = {
        lifetime: start.lifetime,
        source: 'mutation',
        load: null,
      };
      setState({ phase: 'unknown' });
    }
  }

  function handleVisibilityChange(event: React.ChangeEvent<HTMLInputElement>) {
    const searchableByOfficers = event.currentTarget.checked;
    let requestId: string;
    try {
      requestId = createMemberDirectoryRequestId();
    } catch {
      setActionError({
        control: 'visibility',
        invalid: false,
        message: REQUEST_UNAVAILABLE_MESSAGE,
      });
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
      setActionError({
        control: 'remove',
        invalid: false,
        message: REQUEST_UNAVAILABLE_MESSAGE,
      });
      return;
    }
    const start = startMutation('remove');
    if (start === null) return;
    if (document.activeElement === removePhotoButtonRef.current) {
      pendingRemoveFocusIntentRef.current = {
        lifetime: start.lifetime,
        operation: start.operation,
      };
    }
    if (document.activeElement === removePhotoButtonRef.current) {
      pendingConfirmedPhotoFocusIntentRef.current = {
        lifetime: start.lifetime,
        operation: start.operation,
        action: 'remove',
      };
    }
    finishMutation(
      start,
      () => removeMyMemberDirectoryPhoto(app, {
        requestId,
        expectedRevision: start.profile.revision,
      }),
      removeConfirmation,
    );
  }

  function cancelSelectedPhoto() {
    photoReadRef.current = null;
    setPhotoDraft(null);
    setActionError((current) => (current?.control === 'file' ? null : current));
    setState((current) => (current.phase === 'ready'
      ? {
        ...current,
        confirmation: 'Selected photo discarded. Nothing was uploaded.',
      }
      : current));
    photoInputRef.current?.focus();
  }

  async function handlePhotoSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;
    input.value = '';
    if (file === null) return;
    photoReadRef.current = null;
    setPhotoDraft(null);
    setActionError(null);
    setState((current) => (current.phase === 'ready'
      ? { ...current, confirmation: null }
      : current));
    const { type: contentType } = file;
    if (!isAcceptedUploadType(contentType)) {
      setActionError({
        control: 'file',
        invalid: true,
        message: 'Choose a JPG, PNG, or WebP image.',
      });
      return;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      setActionError({
        control: 'file',
        invalid: true,
        message: 'Choose a non-empty image that is 2 MiB or smaller.',
      });
      return;
    }

    const lifetime = lifetimeRef.current;
    if (lifetime === null) return;
    const identity = Symbol('member-directory-photo-read');
    photoReadRef.current = identity;
    setPhotoDraft({ phase: 'reading', identity });
    let base64Data: string;
    try {
      base64Data = await readFileAsBase64(file);
    } catch {
      if (
        lifetimeRef.current !== lifetime
        || photoReadRef.current !== identity
      ) return;
      photoReadRef.current = null;
      setPhotoDraft(null);
      setActionError({
        control: 'file',
        invalid: true,
        message: 'We could not read that image. Choose the file again.',
      });
      return;
    }
    if (
      lifetimeRef.current !== lifetime
      || photoReadRef.current !== identity
    ) return;

    setPhotoDraft({
      phase: 'preview',
      identity,
      contentType,
      base64Data,
      dataUrl: `data:${contentType};base64,${base64Data}`,
      renderState: 'loading',
    });
  }

  function handleDraftRender(identity: symbol, rendered: boolean) {
    if (photoReadRef.current !== identity) return;
    if (!rendered) {
      photoReadRef.current = null;
      setPhotoDraft(null);
      setActionError({
        control: 'file',
        invalid: true,
        message: 'That image could not be displayed. Choose another image.',
      });
      return;
    }
    setPhotoDraft((current) => {
      if (
        current?.phase !== 'preview'
        || current.identity !== identity
      ) return current;
      return {
        ...current,
        renderState: 'ready',
      };
    });
    setActionError((current) => (current?.control === 'file' ? null : current));
  }

  function saveSelectedPhoto() {
    if (
      state.phase !== 'ready'
      || photoDraft?.phase !== 'preview'
      || photoDraft.renderState !== 'ready'
      || photoReadRef.current !== photoDraft.identity
      || mutationRef.current !== null
    ) return;

    let requestId: string;
    try {
      requestId = createMemberDirectoryRequestId();
    } catch {
      setActionError({
        control: 'file',
        invalid: false,
        message: REQUEST_UNAVAILABLE_MESSAGE,
      });
      return;
    }

    const start = startMutation('upload');
    if (start === null) return;
    if (document.activeElement === savePhotoButtonRef.current) {
      pendingConfirmedPhotoFocusIntentRef.current = {
        lifetime: start.lifetime,
        operation: start.operation,
        action: 'upload',
      };
    }
    const { contentType, base64Data } = photoDraft;

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
    const lifetime = lifetimeRef.current;
    if (
      (state.phase !== 'unknown' && state.phase !== 'unavailable')
      || lifetime === null
    ) return;
    recoveryFocusIntentRef.current = {
      lifetime,
      source: 'reload',
      load: null,
    };
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
          <button ref={reloadButtonRef} type="button" onClick={reloadSettings}>
            Reload settings
          </button>
        </div>
      )}

      {(state.phase === 'ready' || state.phase === 'pending') && (() => {
        const { profile } = state;
        const pending = state.phase === 'pending';
        const finderNeedsName = !displayNameEligible && !profile.searchableByOfficers;
        const finderHiddenWithoutName = !displayNameEligible
          && profile.searchableByOfficers;
        let pendingMessage = '';
        if (state.phase === 'pending') {
          if (state.action === 'upload') pendingMessage = 'Saving profile photo...';
          else if (state.action === 'remove') pendingMessage = 'Removing profile photo...';
          else pendingMessage = 'Saving officer finder setting...';
        }
        return (
          <div className="member-directory-profile__controls">
            <div className="member-directory-profile__photo">
              <div className="member-directory-profile__current-photo">
                <strong>Current saved photo</strong>
                {profile.photo ? (
                  <SavedMemberDirectoryPhoto
                    key={profile.photo.version}
                    photo={profile.photo}
                  />
                ) : (
                  <div
                    className="member-directory-profile__placeholder"
                    role="img"
                    aria-label="No profile photo"
                  >
                    No photo
                  </div>
                )}
              </div>
              <div className="member-directory-profile__photo-actions">
                <label htmlFor="member-directory-photo-file">
                  {profile.hasPhoto ? 'Replace profile photo' : 'Add profile photo'}
                </label>
                <input
                  ref={photoInputRef}
                  id="member-directory-photo-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoSelection}
                  disabled={pending}
                  aria-invalid={actionError?.control === 'file'
                    && actionError.invalid
                    ? true
                    : undefined}
                  aria-describedby={[
                    'member-directory-file-help',
                    'member-directory-privacy-description',
                    actionError?.control === 'file'
                      ? 'member-directory-action-error'
                      : null,
                  ].filter(Boolean).join(' ')}
                />
                <span id="member-directory-file-help">
                  JPG, PNG, or WebP. Maximum 2 MiB. The saved thumbnail is processed
                  to remove image metadata; the original upload is not saved.
                </span>
                {profile.hasPhoto && (
                  <button
                    ref={removePhotoButtonRef}
                    type="button"
                    onClick={handleRemovePhoto}
                    disabled={pending}
                    aria-describedby={actionError?.control === 'remove'
                      ? 'member-directory-action-error'
                      : undefined}
                  >
                    Remove current saved photo
                  </button>
                )}
              </div>
            </div>

            {photoDraft && (
              <section
                className="member-directory-profile__draft"
                aria-labelledby="member-directory-photo-draft-heading"
              >
                <div>
                  <h3 id="member-directory-photo-draft-heading">
                    Selected photo — not uploaded yet
                  </h3>
                  <p id="member-directory-photo-draft-description">
                    Review this local preview. Choose Save profile photo to upload
                    it, or Cancel selected photo to discard it without sending it.
                  </p>
                </div>

                {photoDraft.phase === 'reading' && (
                  <p role="status" aria-live="polite" aria-atomic="true">
                    Preparing selected photo preview...
                  </p>
                )}

                {photoDraft.phase === 'preview' && (
                  <div className="member-directory-profile__draft-review">
                    {/* The wording distinguishes this unsaved photo from the saved thumbnail. */}
                    {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                    <img
                      className="member-directory-profile__draft-image"
                      src={photoDraft.dataUrl}
                      width={128}
                      height={128}
                      alt="Selected profile photo preview"
                      onLoad={() => handleDraftRender(photoDraft.identity, true)}
                      onError={() => handleDraftRender(photoDraft.identity, false)}
                    />
                    {photoDraft.renderState === 'loading' && (
                      <p role="status" aria-live="polite" aria-atomic="true">
                        Checking selected photo preview...
                      </p>
                    )}
                    {photoDraft.renderState === 'ready' && (
                      <p role="status" aria-live="polite" aria-atomic="true">
                        Selected photo preview is ready. It has not been uploaded.
                      </p>
                    )}
                  </div>
                )}

                <div className="member-directory-profile__draft-actions">
                  {photoDraft.phase !== 'reading' && (
                    <button
                      ref={savePhotoButtonRef}
                      type="button"
                      onClick={saveSelectedPhoto}
                      disabled={pending || photoDraft.renderState !== 'ready'}
                      aria-describedby={[
                        'member-directory-photo-draft-description',
                        actionError?.control === 'file'
                          ? 'member-directory-action-error'
                          : null,
                      ].filter(Boolean).join(' ')}
                    >
                      Save profile photo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cancelSelectedPhoto}
                    disabled={pending}
                    aria-describedby="member-directory-photo-draft-description"
                  >
                    Cancel selected photo
                  </button>
                </div>
              </section>
            )}

            <div className="member-directory-profile__visibility">
              <label htmlFor="member-directory-searchable">
                <input
                  id="member-directory-searchable"
                  type="checkbox"
                  checked={profile.searchableByOfficers}
                  onChange={handleVisibilityChange}
                  disabled={pending || finderNeedsName}
                  aria-invalid={actionError?.control === 'visibility'
                    && actionError.invalid
                    ? true
                    : undefined}
                  aria-describedby={[
                    'member-directory-privacy-description',
                    !displayNameEligible ? 'member-directory-name-required' : null,
                    actionError?.control === 'visibility'
                      ? 'member-directory-action-error'
                      : null,
                  ].filter(Boolean).join(' ')}
                />
                Let verified website administrators find me by name
              </label>
              {finderNeedsName && (
                <p id="member-directory-name-required">
                  Your current Profile name is not eligible for officer-finder
                  search. Before turning this on, save a name that remains within
                  the 200-character limit after normalization, produces searchable
                  name text at least two characters long, and contains no control
                  or format characters.
                </p>
              )}
              {finderHiddenWithoutName && (
                <p id="member-directory-name-required">
                  This setting is on, but officers cannot find you while your current
                  Profile name is ineligible. You can still turn the setting off.
                  Save an eligible name in the Profile section to become findable again.
                </p>
              )}
            </div>

            {actionError && (
              <p
                id="member-directory-action-error"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
              >
                {actionError.message}
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
  displayName,
  backendAvailable = MEMBER_DIRECTORY_BACKEND_AVAILABLE,
}: {
  app: FirebaseApp;
  uid: string;
  displayName: string | null;
  backendAvailable?: boolean;
}) {
  const displayNameEligible = isMemberDirectoryDisplayNameEligible(displayName);
  if (!backendAvailable) {
    return (
      <MemberDirectoryProfilePreview displayNameEligible={displayNameEligible} />
    );
  }

  return (
    <MemberDirectoryProfileAttempt
      key={`${appIdentity(app)}:${uid}`}
      app={app}
      uid={uid}
      displayNameEligible={displayNameEligible}
    />
  );
}
