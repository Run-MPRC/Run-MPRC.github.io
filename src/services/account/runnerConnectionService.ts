import { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createMemberDirectoryRequestId } from './memberDirectoryService';
import {
  exact,
  invalid,
  readConsent,
  readExclusion,
  readProfile,
  readProfileState,
  readRecommendations,
  readReference,
  Mutation,
  SaveRequest,
  ExclusionRequest,
} from './runnerConnectionContract';

// UI capability only, never server authority. Enabling needs a reviewed release.
export const RUNNER_CONNECTIONS_AVAILABLE: boolean = false;
export const createRunnerRequestId = createMemberDirectoryRequestId;
export function definitiveRejection(failure: unknown): boolean {
  try {
    if (!failure || typeof failure !== 'object') return false;
    const code = Object.getOwnPropertyDescriptor(failure, 'code');
    return (
      !!code
      && Object.prototype.hasOwnProperty.call(code, 'value')
      && [
        'functions/aborted',
        'functions/failed-precondition',
        'functions/invalid-argument',
        'functions/permission-denied',
        'functions/resource-exhausted',
        'functions/unauthenticated',
      ].includes(code.value)
    );
  } catch {
    return false;
  }
}
function mutation(request: Mutation): Mutation {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      request.requestId,
    )
    || !Number.isSafeInteger(request.expectedRevision)
    || Object.is(request.expectedRevision, -0)
    || request.expectedRevision < 0
    || request.expectedRevision >= Number.MAX_SAFE_INTEGER - 1
  ) return invalid();
  return { requestId: request.requestId, expectedRevision: request.expectedRevision };
}
export function createRunnerClient(app: FirebaseApp, uid: string) {
  async function invoke<T>(
    name: string,
    request: object,
    parse: (data: unknown) => T,
  ): Promise<T> {
    // Prevent queued work/results from crossing an account change. Actual
    // authorization remains in Firebase's callable runtime and the server.
    if (!uid || getAuth(app).currentUser?.uid !== uid) return invalid();
    const result = await httpsCallable<object, unknown>(getFunctions(app), name)(request);
    if (getAuth(app).currentUser?.uid !== uid) return invalid();
    return parse(result.data);
  }
  return {
    read: () => invoke('getMyRunnerConnectionProfile', {}, readProfileState),
    recommend: () => invoke('getMyRunnerConnectionRecommendations', {}, readRecommendations),
    save: (input: SaveRequest) => {
      exact(input, [
        'requestId',
        'expectedRevision',
        'profile',
        'consent',
        'adultConfirmed',
        'consentVersion',
      ]);
      if (input.adultConfirmed !== true || input.consentVersion !== 1) return invalid();
      const request = {
        ...mutation(input),
        profile: readProfile(input.profile),
        consent: readConsent(input.consent),
        adultConfirmed: true,
        consentVersion: 1,
      };
      return invoke('saveMyRunnerConnectionProfile', request, (data) => {
        const state = readProfileState(data);
        if (
          state.revision !== request.expectedRevision + 1
          || JSON.stringify(state.profile) !== JSON.stringify(request.profile)
          || JSON.stringify(state.consent) !== JSON.stringify(request.consent)
        ) return invalid();
        return state;
      });
    },
    withdraw: (input: Mutation) => {
      exact(input, ['requestId', 'expectedRevision']);
      const request = mutation(input);
      return invoke('withdrawMyRunnerConnectionProfile', request, (data) => {
        const state = readProfileState(data);
        if (state.revision !== request.expectedRevision + 1
          || state.profile !== null) return invalid();
        return state;
      });
    },
    exclusion: (entryRef: string) => invoke(
      'getMyRunnerConnectionExclusion',
      { entryRef: readReference(entryRef) },
      readExclusion,
    ),
    exclude: (input: ExclusionRequest) => {
      exact(input, ['requestId', 'expectedRevision', 'entryRef', 'hidden', 'blocked']);
      if (typeof input.hidden !== 'boolean' || typeof input.blocked !== 'boolean') return invalid();
      const request = {
        ...mutation(input),
        entryRef: readReference(input.entryRef),
        hidden: input.hidden,
        blocked: input.blocked,
      };
      return invoke('setMyRunnerConnectionExclusion', request, (data) => {
        const state = readExclusion(data);
        if (
          state.revision !== request.expectedRevision + 1
          || state.hidden !== request.hidden
          || state.blocked !== request.blocked
        ) return invalid();
        return state;
      });
    },
  };
}
export type RunnerClient = ReturnType<typeof createRunnerClient>;
