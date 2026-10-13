# Simple System Maps

These diagrams show where pages, information, and deployments go. Each diagram includes a one-sentence text version.

## Member status freshness — #724 source only

```mermaid
flowchart LR
    Member["Disposable staging member"] --> Read["Current status read; no polling"]
    Read --> Server["Validated event/capacity; clock sampled after reads"]
    Server --> Display["Signup availability and separate stored signup"]
    Read -- "Failure or uncertain action" --> Hide["Hide old status/new actions; keep exact saved retry"]
    Hide --> Read
    Display --> Mutation["Existing transactional join/cancel checks decide again"]
```

Text alternative: the staging member page displays server-derived availability separately from stored signup history, hides old status on uncertainty and restores it only after a fresh read, while existing transactions—not the display—continue deciding joins and cancellations; hosted proof remains pending #724.

## Uncertain staging release review — #722

```mermaid
flowchart LR
    Officer["Request a read-only review; no credentials"] --> Specialist["Dave/platform specialist; exact green main"]
    Specialist --> Verify["Fixed staging verification; no deployment"]
    Verify --> Native["Resource, source archive, access and unchanged profiles"]
    Specialist --> Marker["Separate public staging website marker check"]
    Native --> Proof["Dated issue evidence; failure phase means stop"]
    Marker --> Proof
    Verify -. "No writes" .-> Mutations["Build, IAM/Auth/Hosting, member data, production/payments"]
```

Text alternative: an officer asks the specialist for a current read-only staging source/resource/access check and a separate website-marker check, with dated issue proof or a safe stop phase, without another deployment or any account, record or production/payment mutation.

## Fictional account linking — #719, staging verified 2026-10-12

```mermaid
flowchart LR
    Officer["Recent native TOTP + App Check"] --> Permission["Separate expiring v3 association permission"]
    Permission --> Service["Same staging communityActions service"]
    Receipt["Immutable fictional receipt and original current test term"] --> Service
    Target["Owner-marked disposable UID; verified/enabled Auth; pending revision"] --> Service
    Service --> Atomic["Atomic separate link + associated test authority; one receipt/account"]
    Atomic --> Member["Member page: current clock; cancellation keeps original expiry"]
    Browser["Browser including admin"] -. "Direct writes denied" .-> Atomic
    Atomic -. "Never" .-> Real["Auth roles, real money or production"]
```

Text alternative: separately authorized recent-MFA staging officers may atomically connect one immutable fictional current term to one owner-marked verified disposable pending account, with no roles/payments/production change; native release, real screens and exact cleanup passed on October 12, and fresh specialist-supplied fixtures are required for another review.

## Fictional external dues — #716, staging verified 2026-10-12

```mermaid
flowchart LR
    Officer["Disposable staging officer; recent TOTP + native App Check"] --> Permission["Separate live expiring dues permission"]
    Permission --> Service["Same bounded communityActions service"]
    Policy["Server-owned fictional amount/method/short term"] --> Service
    Service --> Receipt["One global confirmation key; immutable unlinked test term/receipt"]
    Receipt --> View["Twenty minimal receipts per page; no profiles"]
    Service --> Audit["Actor/permission/reason/result; saved retry"]
    Browser["Browser including admin"] -. "Direct writes denied" .-> Receipt
```

Text alternative: a recent authenticated officer with a separate expiring dues permission uses the existing service and server-owned fictional policy to record one globally unique, immutable unlinked test receipt and audit, with bounded review and no direct browser write, account access or money movement. Native Function version 3 and Hosting `d212fab` passed hosted UI/security/cleanup checks; fresh specialist-supplied fixtures are required, and real dues/production remain unavailable.

## Staging community lifecycle — #707, first hosted release verified 2026-10-11

Core hosted staging checks for the #711 officer extension below passed on 2026-10-11. Function version 2 and Hosting source `57261ae` are recorded in the [staging guide](./STAGING_COMMUNITY.md#officer-review--711-staging-verified). Expired-session recovery and the no-terminal handoff passed on 2026-10-12; ordinary officer access, lost-authenticator recovery and production are **NOT AVAILABLE YET**.

```mermaid
flowchart LR
    Officer["/community/admin; supervised staging recovery verified"] --> MFA["Verified recent authenticator sign-in + native App Check"]
    MFA --> Cap["Live expiring approval / free-event permission"]
    MFA --> Expired["After ten minutes: request denied; protected sections hidden"]
    Expired --> Reauth["Sign out; sign in with a fresh authenticator code"]
    Reauth --> MFA
    Cap --> One["Same communityActions service; no new reserved instance"]
    One --> Review["20 pending UID/revision requests per page; no profiles"]
    Review --> Approval["Verified target + configured synthetic term; no paid/role grant"]
    One --> Manage["Create closed; edit unbooked; capacity >= bookings; open/close/cancel"]
    Manage --> Seats["Same transactional free-event seat count"]
    One --> Audit["Immutable actor/reason/before/after/result receipt"]
    Browser["Browser including broad admin"] -. "Denied direct access and capability writes" .-> Cap
```

Text alternative: core staged officer checks passed using recent authenticator sign-in and current action permission with the same bounded service for synthetic approval, booking-safe free-event edits and immutable receipts; the browser cannot grant access or write records, expired-session recovery requires a new authenticator sign-in, while ordinary officer access, lost-authenticator recovery and real dues/production remain unavailable.

```mermaid
flowchart LR
    Account["Staging My Account"] --> Page["/community; production disabled"]
    Page --> Login["Signed out: sign in; return to /community"]
    Login --> Identity
    Page --> Identity["Native Auth + App Check; own account only"]
    Identity --> Service["One communityActions Function; min0/max2"]
    Service --> Requests["Pending membership / cancellation request; no paid grant"]
    Service --> Seats["Free event + own registration; atomic seat count"]
    Service --> Commands["Saved command results; old retry cannot change later state"]
    Requests --> Term["Approved synthetic term unchanged; original expiry applies"]
    Browser["Browser member/admin"] -. "Denied direct access" .-> Requests
```

Text alternative: a staging-only account link opens one authenticated service that stores member requests, transactionally manages free-event seats and saves retry results, while preserving the original term and denying direct browser writes; signed-out visitors return after sign-in. First Hosting/provider acceptance is recorded in the staging guide and #707; no production, payment, mail or role-grant path is added.

## Engineering staging billing — checked 2026-10-11

```mermaid
flowchart LR
    Trial["Club Free Trial account\nexpires January 10, 2027"] --> Staging["run-mprc-staging\ntrial billing linked; no Functions deployed"]
    Staging --> Budget["Monthly USD10 gross-usage warnings\ncredits excluded; not a cap"]
    Budget --> Owners["Existing billing notification recipients\nconfiguration verified; delivery untested"]
    Production["Production Firebase project\nbilling remains unlinked"]
```

Text alternative: the club trial funds engineering staging, its gross-usage warning budget notifies existing billing recipients, and production billing remains unlinked.

The [#693 officer cost review](./LOW_COST_COMMUNITY.md#trial-billing-and-cost-warnings--verified-for-engineering-staging-only) records the exact scope and proof. No paid-account upgrade, Function deployment, payment operation, or whole-project spending cap is represented by this map.

## Public page map

```mermaid
flowchart TD
    Site["runmprc.com"] --> Home["Home"]
    Site --> About["About"]
    Site --> Join["Join Us"]
    Site --> Activities["Activities"]
    Site --> Events["Events"]
    Events --> Calendar["Calendar"]
    Events --> Event["Event details"]
    Event --> Registration["Race registration — not approved for live payments"]
    Site --> Shop["Shop pickup catalog — LIVE; no online ordering"]
    Site --> Committee["Committee"]
    Site --> Contact["Contact Us"]
    Site --> Suggestions["Suggestions — source only, not live"]
    Suggestions --> Contact
    Site --> Account["Login and Account"]
    Account --> AuthAction["Verification link page — source only, not live"]
    Site --> Legal["Terms and Privacy"]
    Account --> Admin["Restricted /admin pages — direct link"]
```

In words: public information, account/admin pages, and unfinished commerce
screens share one website; in source only, Suggestions is a public information
page with no form or suggestion record, opens the existing Contact page, and
treats any later email as a separate existing channel, while the live Shop
pickup catalog creates no order or payment and seeing any screen does not mean
it is approved for live commerce.

## Where information lives

```mermaid
flowchart LR
    Public["Current public text and photos in GitHub"] --> Build["Website build"]
    Pickup["Reviewed pickup catalog in GitHub"] --> Build
    Build --> Visitor["Website visitor"]
    Officer["Authorized officer"] --> Admin["Restricted admin pages"]
    Visitor --> Auth["Firebase login"]
    Admin --> Auth
    Auth --> Data["Firebase database"]
    Admin --> Functions["Firebase Functions"]
    Visitor --> Forms["External Google Forms and public links"]
    Functions -. "future live commerce only" .-> Stripe["Stripe"]
```

In words: current public content comes from GitHub; the display-only pickup
catalog is live and creates no operational record, private accounts and other operational
records use Firebase, Google Forms are separate, and Stripe must remain
test-only until approved.

## Event sign-in return — SOURCE ONLY, NOT LIVE

```mermaid
flowchart LR
    Detail["Event details address"] --> DetailLink["Member-price Sign in"]
    Register["Race registration address"] --> RegisterLink["Member-price Sign in"]
    DetailLink --> Login["Login carries the complete website address"]
    RegisterLink --> Login
    Login --> Check{"Existing website-address check accepts it?"}
    Check -- "Yes, after successful sign-in" --> Return["Return to the same event address"]
    Check -- "Missing or unsafe" --> Account["Account"]
    Check -. "Does not grant" .-> Authority["Membership, offer, price, payment, registration, or admin access"]
```

In words: the source-only member-price links carry the complete Event details or Race registration address through Login during the current browser visit, return there after successful sign-in only when the existing website-address check accepts it, use Account when it is missing or unsafe, and grant no club or financial authority.

## How a change reaches people through the protected gate

```mermaid
flowchart TD
    PR["Approved pull request"] --> Main["Merge to main — checks only"]
    Main --> Request["Request one exact-commit release"]
    Request --> Preflight{"Commit and required checks valid?"}
    Preflight -- "No" --> Stop["Red failure — publish nothing"]
    Preflight -- "Yes" --> Prepare["Prepare credential-free artifact"]
    Prepare --> Approval{"Protected environment approved?"}
    Approval -- "No" --> Stop
    Approval -- "Yes" --> Gate{"Project, scope, and authority valid?"}
    Gate -- "No" --> Stop
    Gate -- "Yes" --> Rules["Deploy reviewed Firestore Rules"]
    Rules --> Functions["Deploy and verify named Functions"]
    Functions --> Pages["Pages branch without Netlify's domain claim"]
    Main -. "Ordinary Git production build paused" .-> Netlify
    Main --> HostingSource["#663 Firebase Hosting source checks"]
    HostingSource --> StagingHosting["run-mprc-staging.web.app\nengineering staging only"]
    Main --> AuthSource["#671 exact-main email/password Auth source"]
    AuthSource --> StagingAuth["Staging Auth-only deploy\nprovider readback"]
    StagingAuth --> AuthProof["Disposable API + browser sign-in\ncleanup to zero users"]
    Main --> AppCheckGuard["#676 staging Hosting/App Check\nsource guard"]
    AppCheckGuard --> AppCheckProvider["One score key; two staging hosts;\none-hour web-app registration"]
    AppCheckProvider --> AppCheckHosting["Exact bce911a7 Hosting\nversion 8556fc51210bdc66"]
    AppCheckProvider --> AppCheckEnforce["Auth + Firestore ENFORCED\nreplay protection OFF"]
    AppCheckHosting --> AppCheckPublicProof["Root and Events 200; empty UI;\nno browser warning or error"]
    AppCheckEnforce --> AppCheckDeny["Tokenless Auth 401;\ntokenless Firestore 403"]
    AppCheckEnforce --> AppCheckBrowser["Disposable browser Auth;\ntoken-bearing Events passed"]
    AppCheckBrowser --> AppCheckCleanup["Identity deleted; users and\nroot collections zero"]
    AppCheckCleanup -. "No Functions, real identity,\nprivate flows, or records" .-> Stop
    AuthProof -. "No Functions, real identity, or records" .-> Stop
    StagingHosting -. "No complete backend/provider test estate, protected deploy authority, marker, or rollback" .-> Stop
    HostingSource -. "Production branch, headers, authority, and cutover missing" .-> FutureHosting["Production Firebase Hosting — NOT AVAILABLE YET"]
    Main -. "Completed #685 exact release; manifest inactive" .-> WebGate{"Temporary authority active?"}
    WebGate -- "No" --> Stop
    WebGate -- "Yes" --> Netlify
    Netlify["Netlify — current live host; reusable protected publication unavailable"] --> Live["runmprc.com"]
    Pages -. "existing provider claim still conflicts until verified clear" .-> Live
    Dev["dev — legacy branch"] -. "do not use for new release work" .-> PR
```

In words: merge, release request, and protected approval are separate; #663 supplies build checks, #665 publishes the club-owned engineering staging site, and #671 deploys only narrow email/password Auth after exact-main review. Its earlier disposable identities were removed. #676 adds one restricted score-based provider registration, publishes exact source `bce911a7` as Hosting version `8556fc51210bdc66`, and sets Auth plus Firestore to `ENFORCED` with replay protection `OFF`; tokenless Auth/Firestore requests were denied, genuine browser Auth/Events passed, and cleanup returned users and root collections to zero. The current boundary still supplies no Functions, real identity/private-data testing, production release, or reusable authority. Ordinary merges cannot publish Netlify. The completed #685 exception is inactive after exact repause; deploy `6aa8c5b3fddd040009eba99c` remains live from source `41a9ae4ebc719212df610ff5cdcf9ca4eab18e71`. #659 deploy `6a7ece87c5ca4d0007c1a3fc` and source `7496fe0881fb52908c4ff2f40f488df09c94c908` are immediate rollback; completed #623 deploy `6a7e072f8f346b0008510d29` and #473 deploy `6a6dc9ea588b0c0008036312` are older history. The temporary #685 refs are absent, while old #473/#623/#659 hot refs preserve a documented latent manual-rebuild risk. The future Pages branch must stop claiming the Netlify domain, and every host still needs separate proof.

## Account and permission ownership

```mermaid
flowchart TD
    Board["MPRC board"] --> People["At least two named officers"]
    People --> GitHub["Individual GitHub accounts"]
    People --> Netlify["Individual Netlify accounts"]
    People --> Cloud["Scoped Firebase and cloud accounts"]
    People --> Finance["Scoped Stripe finance accounts"]
    People --> Domain["Domain and DNS access"]
    Vault["Approved password manager"] --> Recovery["Recovery location — no secrets in guides"]
    Recovery --> People
    AI["Approved AI tool"] --> GitHub
```

In words: people use their own accounts, at least two officers cover every service, and recovery information stays in the approved password manager rather than the repository or AI.

## Role-based Firebase access — SOURCE ONLY, NOT LIVE

```mermaid
flowchart TD
    SignIn["Person signs in"] --> Own{"Safe action on their own profile?"}
    Own -- "Yes" --> Self["Use the existing own-account permission"]
    Own -- "No; private role access" --> Verified{"Account email verified?"}
    Verified -- "No" --> Deny["Deny private member/admin access"]
    Verified -- "Yes" --> Role{"Allowed member/admin role?"}
    Role -- "No" --> Deny
    Role -- "Yes" --> Surface{"Website display, database read, or server Function?"}
    Surface --> Website["Show matching website controls\nnot permission by itself"]
    Surface --> Rules["Apply the specific database permission"]
    Surface --> Function["Apply the specific Function guard"]
    Verified -. "does not grant" .-> Role
```

In words: safe self-service is limited to the person's own signed-in account; the website shows member/admin controls only when the refreshed account token contains both verified-email proof and the already-approved role, while the database and server check those facts again because a visible control is never permission.

Issue [#196](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/196) owns the database Rules source/test boundary. Issue [#209](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/209) owns the matching current server-Function boundary for admin actions, member checkout treatment, and registration export. Issue [#213](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/213) owns the website display match. All are **NOT LIVE** until the exact Rules and Functions revisions are deployed backend-first, the exact website is published to protected staging second, and the complete made-up-account matrix passes. An officer must not edit a profile, toggle a role, open real member data, or use a real account as a workaround or test. Registration export still needs separate purpose, minimum-column, recent-auth, audit, and limit work under [#116](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/116).

## Member profile setup and recovery — NOT LIVE YET

```mermaid
flowchart TD
    SignIn["Member signs in"] --> Ensure["Server checks this member's profile"]
    Ensure --> Existing{"Profile already exists?"}
    Existing -- "Yes" --> Preserve["Keep every field and role unchanged"]
    Existing -- "No" --> Pending["Create one pending profile"]
    Preserve --> Read["Website reads through normal Firebase permissions"]
    Pending --> Read
    Read -- "Read succeeds" --> Edit["Member may edit name only"]
    Read -- "Read succeeds" --> Phone["Phone display and entry paused\nexisting value unchanged"]
    Read -- "Setup or read fails" --> Safe["Edit stays hidden; Try again or sign out"]
    Ensure -. "does not grant, remove, or change" .-> Access["Membership, payment, discount, or admin access"]
```

In words: a signed-in member gets their existing profile unchanged or one new pending profile; the website permits only name editing after the normal permission check succeeds, while phone display and entry stay paused without changing an existing stored value. The repair does not change actual access. If displayed profile status and actual access disagree, stop and escalate.

Issue [#118](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/118) owns this repair, and [#178](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/178) owns the temporary phone-collection pause. Source code and local tests do not make either live. The website, server Function, database permissions, and made-up live check must each be proven separately.

## Optional profile photo and officer People finder — INERT FRONTEND PREVIEW LIVE; BACKEND NOT LIVE

```mermaid
flowchart TD
    Account["Signed-in person's Account page"] --> Photo["Photo preview and disabled Choose photo control"]
    Account --> Choice["Disabled default-off searchable choice"]
    Admin["Existing admin guard"] --> Finder["People finder page"]
    Finder --> Input["Disabled name input and Search button"]
    Photo -. "No upload or request" .-> Backend["Directory backend — NOT LIVE"]
    Choice -. "No save or request" .-> Backend
    Input -. "No search or results" .-> Backend
    Face["Face or photo search"] --> Never["Not authorized and not available"]
    Finder -. "does not prove or change" .-> Records["Membership, role, registration, payment, or official roster"]
```

In words: the live artifact contains the inert photo, searchable-setting, and People finder layouts, but every new control is disabled, no directory request or result is possible, and the backend is not live. Synthetic tests prove the protected Account and administrator layouts; production proof stayed signed out and confirmed only the normal guards and absence of a directory request. Face or photo search is neither authorized nor available, and seeing the interface proves no membership or authority.

Issue [#623](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/623) published only this bounded inert interface. Connected source from [#505](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/505) and [#506](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/506) was deliberately excluded from the production artifact. Issue [#507](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/507) still owns privacy approval, backend-first release, website publication of connected behavior, and live proof. No issue authorizes a photo query, facial recognition, similarity matching, or biometric processing. Do not use real names or photos to test the inert preview.

## Verification email action — SOURCE ONLY, NOT LIVE

```mermaid
flowchart LR
    Email["Private Firebase email"] --> Page["/auth/action"]
    Page --> Remove["Remove query and fragment"]
    Remove --> Button["Wait for Verify email button"]
    Scanner["Mail scanner opens page"] --> NoChange["No account change"]
    Button --> Firebase["Firebase confirms verification operation"]
    Firebase --> Plain["Plain result; no email or code"]
    Plain -. "does not grant" .-> Access["Membership, payment, discounts, or admin"]
```

In words: the source page removes the private code, waits for the member to choose one button, and shows a plain result; simply opening the page does nothing and verification never grants club access.

Issue [#194](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/194) owns only the verification path. Firebase's single custom handler also receives password-reset and email-recovery links, so [#119](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/119) must keep the default handler or wait for safe coverage of every mode before enabling this route. Website, provider, and live behavior remain separate proof.

## Scoped engineering profile release — #701

```mermaid
flowchart LR
    Main["Exact main; six green checks"] --> Gate["Dave normal approval; no bypass"]
    Gate --> Deploy["Thirty-minute keyless staging release"]
    Deploy --> Build["Build identity: source, images, logs only"]
    Build --> Two["Signup profile and profile recovery only"]
    Two --> Runtime["Runtime: Auth read; database get/create"]
    Runtime --> Stage["VERIFIED staging; made-up profiles cleaned up"]
    Two -. "no release or access" .-> Excluded["Production, payments, email, website publication"]
```

Text alternative: exact green main and Dave's normal approval permitted the verified two-profile staging release; separate build/runtime identities passed synthetic checks and cleanup, excluding production, payments, email and website publication. #701 records the separate hosted proof; this does not complete the broader platform.

## Emergency decision

```mermaid
flowchart TD
    Problem["Problem noticed"] --> Private{"Private data, access, money, or secret involved?"}
    Private -- "Yes" --> Stop["Stop changes and contact specialist owners"]
    Private -- "No" --> Public{"Only wrong public content?"}
    Public -- "Yes" --> Revert["Prepare one reviewed revert"]
    Public -- "No" --> Host["Check Netlify, GitHub Pages, and Firebase separately"]
    Stop --> Verify["Preserve redacted evidence and verify recovery"]
    Revert --> Verify
    Host --> Verify
```

In words: stop and escalate anything involving privacy, access, money, or secrets; otherwise use one reviewed rollback and check every affected service.
