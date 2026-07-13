# Simple System Maps

These diagrams show where pages, information, and deployments go. Each diagram includes a one-sentence text version.

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
    Site --> Shop["Shop — not approved for live payments"]
    Site --> Committee["Committee"]
    Site --> Contact["Contact Us"]
    Site --> Account["Login and Account"]
    Site --> Legal["Terms and Privacy"]
    Account --> Admin["Restricted /admin pages — direct link"]
```

In words: public information, account/admin pages, and unfinished commerce screens share one website; seeing a screen does not mean it is approved for live use.

## Where information lives

```mermaid
flowchart LR
    Public["Public text and photos in GitHub"] --> Build["Website build"]
    Build --> Visitor["Website visitor"]
    Officer["Authorized officer"] --> Admin["Restricted admin pages"]
    Visitor --> Auth["Firebase login"]
    Admin --> Auth
    Auth --> Data["Firebase database"]
    Admin --> Functions["Firebase Functions"]
    Visitor --> Forms["External Google Forms and public links"]
    Functions -. "future live commerce only" .-> Stripe["Stripe"]
```

In words: public content comes from GitHub; private accounts and operational records use Firebase; Google Forms are separate; Stripe must remain test-only until approved.

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
    Main -. "Git-triggered production build paused" .-> Netlify
    Netlify["Netlify — current live host; protected publication unavailable"] --> Live["runmprc.com"]
    Pages -. "existing provider claim still conflicts until verified clear" .-> Live
    Dev["dev — legacy branch"] -. "do not use for new release work" .-> PR
```

In words: merge, release request, and protected approval are separate; a missing or failed Firebase gate publishes nothing; the future Pages branch must stop claiming the Netlify domain, and both hosts still need separate proof.

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
