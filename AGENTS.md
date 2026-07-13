# Repository Instructions for Coding Agents

These instructions apply to all work in this repository. They supplement the issue being implemented; if an issue conflicts with a security invariant below, stop and escalate rather than weakening the invariant.

## Read before changing code

For architecture, security, commerce, or operations work, read the relevant root documents:

- `SYSTEM_DESIGN.md`
- `STRIPE_COMMERCE_DESIGN.md`
- `SECURITY.md`
- `IMPLEMENTATION_PLAN.md`
- `OPERATIONS_RUNBOOK.md`
- The exact issue in `GITHUB_ISSUES.md`

Existing files under `docs/` contain useful historical context but may predate the commerce platform. Root documents are authoritative for the target design.

For every officer-visible or operational change, also read:

- `OFFICER_START_HERE.md`
- `docs/officers/README.md`
- The short officer task guide affected by the issue

## Officer continuity documentation

Treat `OFFICER_START_HERE.md` and `docs/officers/` as product surfaces, not optional project notes.

- Start every delivery summary with the outcome in plain language.
- Every issue and pull request must state:
  - `Officer impact: <plain-language effect>`
  - `Officer documentation: <updated paths>` or `None — <specific reason>`
  - `Deployment evidence: <website, Firebase, and provider surfaces verified>`
- Update the relevant officer guide in the same pull request when work changes public content, navigation, admin duties, collected data, permissions, deployment, hosting, external accounts, payments, refunds, incidents, backup, or recovery.
- Officer guides describe current verified behavior. Mark future behavior `NOT AVAILABLE YET`; do not mix planned steps into a procedure that looks usable now.
- Use short sentences, ordinary words, and one action per numbered step. Define an unavoidable technical term once in the glossary.
- Every procedure must name its purpose, approver, prerequisites, steps, expected result, stop conditions, success proof, undo path, and escalation role.
- Do not make an officer edit source files, run terminal commands, handle secrets, or change production data as the primary continuity path. Use an issue, a small reviewed pull request, and named approval.
- Never ask an officer to paste passwords, recovery codes, secrets, customer/member data, payment data, or production records into an issue, screenshot, email, or AI tool.
- If page structure, data movement, permissions, account ownership, or deployment changes, update the matching Mermaid diagram and its one-sentence text alternative.
- Distinguish these states explicitly: source changed, tests passed, code merged, website published, `runmprc.com` verified, Firebase deployed, outside provider configured, and production behavior verified.
- A green workflow alone does not prove a website, Firebase, or provider change is live. Read job details for skipped steps and verify each affected surface.
- Redact screenshots, include the check date, and pair each visual with written steps.
- Before closing an issue, review the affected procedure as a backup officer with no terminal. Record any step that still requires a specialist.

## Non-negotiable safety rules

- Never use, request, print, commit, or copy production secrets or real customer/runner data.
- Never test checkout, refunds, role changes, email, Strava, migrations, or destructive behavior against production.
- In local development, Auth, Firestore, and Functions must all target emulators; Stripe must be in test mode.
- The browser never decides price, member eligibility, payment state, capacity, inventory, refund limits, or authorization.
- A redirect or client field never proves payment. Only verified Stripe state may confirm it.
- Every external create/refund/email and every webhook transition must be idempotent and retry-safe.
- Financial state, webhook events, audit records, rate limits, mail outbox, and OAuth secrets are server-only writes. Browser admins are not a trusted server boundary.
- Do not add an admin catch-all Firestore rule.
- Do not log request bodies, Checkout URLs, bearer/confirmation tokens, addresses, DOB, emergency contacts, Stripe/OAuth secrets, or raw ID tokens.
- Do not make legal, tax, insurance, waiver, retention, shipping, or refund-policy decisions. Implement only an approved decision or surface the blocker.
- Preserve unrelated worktree changes, especially generated or user-modified files such as `public/sitemap.xml`.

## Issue workflow

1. Work on one issue/outcome at a time and confirm its dependencies are complete.
2. Inspect the current implementation; documentation is a design, not proof the code already matches it.
3. State the invariant, allowed transitions, failure cases, and migration impact.
4. Add a test that demonstrates the defect or missing behavior before/with the fix.
5. Make the smallest backward-compatible change that satisfies the issue.
6. Use additive schema changes and idempotent, dry-runnable backfills.
7. Run focused checks, then the relevant full suite.
8. Review the diff for authorization, App Check, input bounds, PII/secrets, idempotency, impossible state transitions, and production fallback.
9. Update affected root documentation and the issue status/evidence.
10. Report commands/results and any residual risk; do not imply external production configuration was verified from source code.

Split an issue before implementation if it cannot be safely reviewed as one focused pull request.

## Repository map

- `src/`: React web application and client services. Treat it as untrusted input/UI.
- `functions/`: trusted Firebase Functions boundary. Validate every request and external response.
- `firestore.rules`: browser access boundary. Admin SDK bypasses it, so also review server IAM/code.
- `tests/firestore-rules/`: required allow/deny tests for every rule change.
- `.github/workflows/`: CI and deployment trust boundary.
- `public/404.html`, `public/index.html`, and `public/spa-navigation.js`: current same-origin GitHub Pages SPA callback bridge and its shared tested logic.
- `docs/`: historical/developer/content context.
- `docs/officers/`: current plain-language officer procedures, maps, continuity, and emergency guidance.

## Verification

Use Node.js 20 and lockfile installs.

Commands available on the current `main` baseline:

```bash
npm ci --legacy-peer-deps
npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run test:run -- --runInBand
CI=true npm test -- --watchAll=false --runInBand
npm run test:spa-navigation
npm run test:rules
CI=true DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build
```

The Rules suite needs Java 17. The direct `react-scripts build` command is preferred for a diagnostic build because normal `npm run build` regenerates the sitemap. Run dependency audits for security/dependency issues, but do not apply forced automatic upgrades.

The deterministic frontend Jest baseline is available through the command above. Hosted CI runs that command as the blocking `Run frontend Jest tests` step under #124. This proves the suite ran for that commit; it does not prove branch protection, website publication, Firebase deployment, provider configuration, or production behavior. The remaining fail-closed lint and deployment work stays open under #105.

For Firebase-backed local development, run `npm run emulators` first and wait until Auth, Firestore, and Functions are ready under `demo-mprc-local`. In a second terminal, run `npm start` and use `http://localhost:3000`. Stop if any browser Firebase request uses a non-loopback host. The emulator suite does not isolate Stripe, Strava, email, or other provider calls made by Functions; those flows remain forbidden until their test configuration and safe sink are separately proven.

Optimized builds and current deploy previews still use production Firebase configuration. Do not sign in, open private/admin pages, or exercise Firebase/provider behavior in a preview. Safe staging and provider isolation remain **NOT AVAILABLE YET** under #105/CONFIG.

For Stripe lifecycle work, tests must include relevant negative and retry cases: invalid signature, duplicate/out-of-order Event, unpaid completion, amount/currency/environment mismatch, terminal-state protection, async success/failure, expiration, cancellation, and refund retry. Capacity/inventory work must include concurrent final-unit tests.

## Code conventions

- Preserve the current CommonJS style in `functions/` unless a dedicated migration issue changes it.
- Keep server-authoritative domain logic out of React components.
- Prefer small pure helpers for validation and state transitions so they can be exhaustively unit-tested.
- Use integer cents and explicit currency; never floating-point money.
- Use stable opaque IDs and schema-versioned minimal Stripe metadata; never put PII in metadata.
- Use structured, redacted logs with correlation IDs.
- Avoid mutable unbounded arrays for audit history; use append-oriented records.
- Do not add a new dependency when a small maintained-platform capability suffices. Any dependency change requires lockfile review and an audit.

## Definition of done

An issue is not complete until implementation, positive/negative tests, relevant full checks, migration/compatibility notes, redacted logging review, engineering documentation, and the applicable officer-facing handoff are complete. Provider Console, IAM, DNS, legal, or live-mode work also requires private evidence and named owner approval outside the repository. If officer documentation is not affected, state the specific reason in the pull request.
