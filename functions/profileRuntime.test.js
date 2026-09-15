// Use the installed SDK, not a fluent-builder mock, to inspect what deployment
// will receive. Importing these modules never invokes Auth, Firestore or a user.
const { onSignUp } = require('./signup');
const { ensureMemberProfile } = require('./ensureMemberProfile');

describe('minimal profile backend resource limits', () => {
  const originalProject = process.env.GCLOUD_PROJECT;

  beforeAll(() => {
    // Auth endpoint metadata needs a project label even though no request is
    // sent. Keep this fixture self-contained in credential-free hosted CI.
    process.env.GCLOUD_PROJECT = 'demo-mprc-local';
  });

  afterAll(() => {
    if (originalProject === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = originalProject;
  });

  test.each([
    ['createMemberOnSignUp', onSignUp],
    ['ensureMemberProfile', ensureMemberProfile],
  ])('%s emits the exact low-idle, bounded resource settings', (name, handler) => {
    expect(handler.__endpoint).toMatchObject({
      platform: 'gcfv1',
      minInstances: 0,
      maxInstances: 2,
      availableMemoryMb: 256,
      timeoutSeconds: 30,
    });
  });

  test('keeps the existing Auth-created trigger and callable identities', () => {
    expect(onSignUp.__endpoint.eventTrigger.eventType)
      .toBe('providers/firebase.auth/eventTypes/user.create');
    expect(ensureMemberProfile.__endpoint.callableTrigger).toBeDefined();
    expect(onSignUp.__endpoint.callableTrigger).toBeUndefined();
    expect(ensureMemberProfile.__endpoint.eventTrigger).toBeUndefined();
  });
});
