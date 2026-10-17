# Connect and qualify hosted test dues — #742

**October 17, 2026: connected and deployed in staging at `71f59e2`; core hosted flow and bounded failure/recovery checks verified.** Read the [native evidence, cleanup and remaining qualification](./TEST_DUES_HOSTED_EVIDENCE.md) before repeating any procedure. Read the [later native failure/recovery receipt and limits](./TEST_DUES_NATIVE_RECOVERY.md). This is a specialist runbook; completed fixtures must not be recreated. Real payments and production remain unavailable.

## Authority and scope

Dave authorizes this isolated staging outcome. Genuine Opus 5.5 medium/max APPROVE on the exact head plus all six CI jobs and every step green supplies delegated code approval. Provider/account ownership and privately entered credentials remain separate evidence. Use only `run-mprc-staging` (native project number `384996399199`) and the club-owned Stripe sandbox. Never activate a live Stripe account, add real bank/card details, enable `COMMERCE_ENABLED`, use real member records, or rerun sealed #731.

The new release path ships only `duesTestOnly.js` and its closed dependency list. It creates or updates exactly `membershipTestDues` and `membershipTestDuesWebhook`, each Node 22, min 0/max 2, 256 MB, 30 seconds, in `us-central1`. Existing profile and community Functions must remain identical. No mail, worker, scheduler, new package, Rules allowance or migration is introduced. Builds, secret use and requests can incur staging usage; the existing $10 warning is not a spending cap.

## Private provider setup — owner and specialist

1. The owner finishes Google/Stripe sign-in and MFA in the club's browser session. Never put passwords, codes or keys in chat, GitHub, logs or screenshots.
2. Identify the club account. Open its dedicated general sandbox and verify the sandbox banner. Stop if account ownership or isolation is uncertain. Stripe recommends a separate sandbox for new integrations because its data and settings are isolated from live mode: [Stripe keys](https://docs.stripe.com/keys), [sandbox management](https://docs.stripe.com/sandboxes/dashboard/manage).
3. Record only the sandbox's nonsecret `acct_…` identifier and its dashboard location in the private release receipt. No account creation, agreement acceptance or broader access is implied by reaching sign-in. The owner performs new credential creation privately; browser security grants require confirmation at action time.
4. Prefer a service-specific restricted sandbox key for future owner-managed credential replacement. The October 17 connection used the owner-approved existing full-access test key; a restricted-key permission matrix was not natively qualified. The runtime supports `rk_test_` and the existing `sk_test_` format, never live, publishable or organization keys. Prefer the restricted key. The adapter's required operations are `GET /v1/account`, create/retrieve/list Checkout Sessions, retrieve PaymentIntents with expanded latest Charge, and retrieve Charges. Configure the matching minimum Dashboard permissions and qualify each native operation; do not guess success from a permission label. No refund, payout, subscription, webhook-management or general account-write permission is needed by the runtime. See [restricted keys](https://docs.stripe.com/keys/restricted-api-keys).
5. Configure one sandbox-only webhook destination at `https://us-central1-run-mprc-staging.cloudfunctions.net/membershipTestDuesWebhook`. Use API version `2023-10-16`, ordinary account events, and exactly: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`. Do not subscribe to all events or a live account. Creation can precede deployment; delivery is not qualified until the receiver is live. See [Stripe webhooks](https://docs.stripe.com/webhooks).
6. The owner privately stores the test API key and that endpoint's signing secret in the two staging secrets below. The release scripts inspect metadata only and never fetch secret payloads. A successful signature test using another endpoint's secret is not proof for this endpoint.

## Minimum Google setup — specialist only, after code approval

Enable only Secret Manager in the existing staging project. Create the keyless service account `mprc-test-dues-runtime@run-mprc-staging.iam.gserviceaccount.com`. Bind only the custom project role `mprcTestDuesRuntime` with these six permissions:

- `datastore.databases.get`
- `datastore.entities.get`
- `datastore.entities.create`
- `datastore.entities.update`
- `datastore.entities.list`
- `firebaseauth.users.get`

Create exactly `MPRC_TEST_STRIPE_KEY` and `MPRC_TEST_STRIPE_WEBHOOK_SECRET`, labeled `managed-by=mprc-test-dues-stage`. Each secret's own IAM policy grants `roles/secretmanager.secretAccessor` only to the new runtime. Do not grant that permission at project level or to existing profile/community/build identities. Keep secret payload entry private. Retain the existing build account/repository and platform service-agent arrangement; verify the required deploy/act-as path rather than adding broad roles. No user-managed service-account key is permitted.

Create a small **nonsecret**, task-owned plan file outside Git with exactly:

```json
{"stripeAccount":"acct_REPLACE_WITH_VERIFIED_SANDBOX","keyVersion":"1","webhookVersion":"1"}
```

Replace all three values with observed account and enabled numeric secret-version identifiers. `latest`, extra keys and foreign projects fail closed. The plan never contains a credential. The fixed native project identity, exact runtime role/project bindings, zero user-managed keys, per-secret access, labels and pinned enabled versions are checked before release and again after verification. Explicit project-wide Secret Manager accessor/admin grants also stop the release, including grants to other accounts. Existing owner/platform authority remains; these checks are not a complete organization-wide IAM audit.

## Reviewed release and verification — specialist only

Keep the checkout clean at exact current green `main`. Preserve any preexisting ignored build directory with its hash manifest and restore it after the staging build; do not overwrite another task's artifact. Run these commands only after provider setup and exact-head approval:

```text
node scripts/staging-test-dues-release.js deploy /absolute/path/to/nonsecret-plan.json
node scripts/staging-test-dues-release.js verify /absolute/path/to/nonsecret-plan.json
node scripts/staging-community-hosting.js test-dues /absolute/path/to/nonsecret-plan.json
```

The deploy path uploads one deterministic, bounded source archive per target, validates native settings and public transport IAM, and downloads both actual source archives to compare hashes. Public transport is necessary for Firebase callable Auth/App Check and the Stripe signature boundary; it grants no Firestore access. Every mutation rechecks current-main CI. Verification accepts ancestor source only with identical current reviewed archive bytes. Missing setup is a failure, not an automatic repair. A partial deployment leaves the screen disabled. An existing ACTIVE target may be preserved while completing the same reviewed release. A failed or inactive target stops inventory validation: preserve the native receipts and prepare a separate reviewed specialist repair. Do not delete a Function or its evidence as an automatic recovery step.

The Hosting command verifies both dues archives/settings/account/secret bindings and provenance before building, then rechecks before publication. Only this explicit mode sets the frontend dues flag. The ordinary Hosting command clears any inherited dues flag. The public release marker adds the dues bundle hash, not credentials or account details. Existing profile/community release paths can recognize and preserve these exact isolated dues Functions; they cannot deploy dues through their older targets.

## Native acceptance, cleanup and recovery

Use fresh, uniquely inventoried fictional accounts, current private `membershipTestParticipants` markers and one free event. Do not reuse deleted fixtures. A specialist supplies these through an exact-owned, fenced operation; ordinary officers do not change database records or grant roles.

Prove native Auth/App Check, caller/current-account/marker denials and actual invalid raw-body signature rejection. Use genuine hosted Stripe test Checkout for both server amounts, unpaid/cancel-return, interrupted/resumed checkout, duplicate/retried requests, webhook-before-return, missed-callback reconciliation and automatic canonical payer activation/free-event admission. Verify phone and desktop behavior. The selected card-only mode does not supply an asynchronous payment-method UI; distinguish native provider event/delivery evidence from synthetic async lifecycle coverage. No redirect or browser field proves payment. Preserve the existing failed-card/expired-session hold for specialist reconciliation.

Before reporting completion, record exact reviewed/merged source, all CI jobs/steps, deployed Function versions/archive hashes, runtime/secret metadata, sandbox account/endpoint/version/event-delivery state, matching Hosting version/asset hashes, actual screen results and owned cleanup. Source/emulator proof is not hosted or live payment proof. A provider failure stays unresolved; never replace it with a synthetic success claim.

Disable disposable participant markers first. Resolve or expire only the exact owned open sandbox Sessions through the provider owner before removing owned test fixtures; never blindly create replacement charges. Preserve unresolved purchase and immutable payment evidence for reconciliation, and use identity/update-time fences plus absence checks for authorized cleanup. Clean temporary source bundles automatically and keep bounded, redacted release receipts in the named task artifact directory.

**Undo:** stop new test access, publish the reviewed no-dues Hosting mode, then disable the isolated dues feature through a compatible reviewed release. Keep the endpoint, pinned secrets and unresolved records until the owner confirms no owed webhook/reconciliation work remains. Do not delete secrets or financial evidence to hide a partial release. Real refund issuance, live activation and policy decisions remain separate.

**Backup-officer walkthrough:** the officer opens the supplied test screen and follows [Test annual dues](./officers/TEST_DUES.md). Sign-in, sandbox/secret/IAM setup, release, fixtures, failed-payment reconciliation and cleanup still require Dave and the specialist. No step asks a backup officer for a terminal, credential, role grant or member record.
