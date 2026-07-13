const admin = require('firebase-admin');
const { ensureMemberProfileDocument } = require('./memberProfile');

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

describeWithEmulator('member profile Firestore transaction', () => {
  const uid = 'synthetic-concurrency-user';
  let db;

  beforeAll(() => {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-functions-test' });
    }
    db = admin.firestore();
  });

  beforeEach(async () => {
    await db.collection('members').doc(uid).delete();
  });

  afterAll(async () => {
    await db.collection('members').doc(uid).delete();
    await Promise.all(admin.apps.map((app) => app.delete()));
  });

  test('parallel retries create once and never overwrite the final record', async () => {
    const syntheticUser = {
      uid,
      email: 'synthetic@example.test',
      emailVerified: true,
      displayName: 'Synthetic Runner',
      phoneNumber: '+16505550123',
      providerData: [{ providerId: 'password' }],
    };

    const results = await Promise.all(
      Array.from({ length: 12 }, () => ensureMemberProfileDocument(syntheticUser)),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);

    const ref = db.collection('members').doc(uid);
    await ref.update({
      fullName: 'Member-edited name',
      phoneNumber: 'Member-edited phone',
      role: 'member',
    });
    const beforeRetry = (await ref.get()).data();

    await expect(ensureMemberProfileDocument({
      ...syntheticUser,
      displayName: 'Must not replace member data',
    })).resolves.toEqual({ created: false });

    expect((await ref.get()).data()).toEqual(beforeRetry);
  });
});
