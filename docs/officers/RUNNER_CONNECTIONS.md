# Finding running partners — NOT AVAILABLE YET

**Purpose:** explain the proposed opt-in member experience and how to review its
development without exposing member records.

**Approver:** Dave Liu for source development. A membership lead and the club's
privacy/security owner must approve the consent wording and live pilot. Dave
selected member-confirmed 18+ on September 27; this is not verified age.

**Prerequisites:** [issue #689](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/689),
a reviewed implementation, synthetic testing, and the existing protected backend
release. A specialist is still required for implementation and release.

## What works now

An internal matching calculation, private storage and profile service pass tests
with made-up runners and accounts in local test systems. The service checks
current accounts and membership terms; a member/admin role alone does not grant
access. The disabled recommendation service also has local tests for daily
suggestions, hide/block controls and privacy checks before returning a card.
The member form, preview, suggestions and privacy controls now also pass tests
with made-up data. The page remains disabled and no card is published.
The runner service has not been released to members. An automatic pull-request
preview is not a member release or a connected backend test.
The officer lookup setting does not authorize member discovery.

The tested form asks members to confirm they are 18 or older. It does not
collect a birth date or claim to verify age or identity. For a new profile the
box starts unchecked, as do all sharing choices. Withdrawal clears the
confirmation, so joining again requires a new confirmation. Club membership is
checked separately by the tested server code.
Approved membership records and officer procedures are still a release
prerequisite. Do not enter records directly to bypass that work.

The tested service allows a person whose membership expired to read or withdraw
only their own card while their verified account remains usable. Saving requires
current membership. Disabled, deleted, revoked or unverified accounts need
account recovery or private support. Separate limits preserve withdrawal when
the save limit has been reached. These are source behaviors, not live tools.

The tested recommendation service offers at most four ordinary suggestions and
one separately opted-in broadening suggestion per day. Refreshing or hiding
cards does not reveal more people that day. Hiding affects only your results;
blocking prevents the pair from appearing to either person. Undo changes only
your own choice. Suggestions are checked again before they are returned, but
information already delivered cannot be taken back. The tested interface allows
undo for choices made during the current visit only. It still needs a clear way
to recover and review choices from earlier visits. Retention and account
deletion procedures must be approved before a pilot; no retention period has
been selected by this code.

The form shows the exact card before saving. Changing card details removes the
old preview. Turning discovery off clears both suggestion choices; turning it
back on does not recheck them. If a save reply is uncertain, the form stops other
edits and offers **Retry the same change** instead of claiming success. Switching
accounts clears the old page state. Suggestions clear when the page loses focus,
when today's window ends, or when a new request fails. These safeguards do not
prove hosted access is ready. Public club-run information needs no runner profile.

The September 27 phone and desktop demonstration used a disposable, made-up
in-memory service. It did not connect to Firebase or create accounts. The phone
layout had no horizontal overflow; preview, save, block, own-choice undo and
withdrawal screens worked. No screenshot artifact was retained.

A separate local test now sends the actual client requests through the local
backend, using only made-up accounts. It proves saves, suggestions, blocking,
undo, withdrawal, membership/account checks and recovery after a lost save reply.
This is stronger than the fake-service demonstration, but still not a connected
browser pilot. The local test system does not verify Google's token signatures;
the hosted identity and app-protection checks still need separate proof. The
test does not use an officer's credentials or change billing.

A later September 27 demonstration connected the actual form and client to the
local backend. A saved made-up card survived a page reload and fresh sign-in.
Phone checks proved suggestions, blocking, own undo and withdrawal, with no
horizontal overflow. Withdrawal stayed in effect after a reload; an account
without a made-up membership could not save. The test accounts and records were
removed afterward. This uses a special test account selector, not the website's
normal sign-in route. It still does not prove hosted access or a live pilot.

## Review steps

1. Ask the platform owner for the issue's current source and test record.
2. Confirm any demonstration labels all made-up runners as synthetic.
3. Check that normal run information stays public without a runner profile.
4. Before a pilot, request proof of explicit opt-in, withdrawal, blocking,
   current member access, the unchecked 18+ confirmation and private-data protection.
5. Request a demonstration that hiding, blocking, withdrawal and membership loss
   remove suggestions without filling the space with new people that day.
6. Check that the card preview excludes contact details and private preferences.
7. Ask to see an uncertain save and its same-request retry, using made-up data.
8. Before a pilot, request a working way to recover privacy choices after leaving
   and returning to the page. The current visit-only undo is insufficient.
9. Request separate website and Firebase deployment evidence before announcing
   the feature. A calculation test or green build is not proof of availability.
10. Ask which checks used the local test system and which proved the hosted
    service. Do not accept local token tests as proof of hosted identity checks.
11. Ask for the connected local demonstration's cleanup record. It must show
    zero remaining test users and collections, with the local services stopped.

**Expected result:** officers can distinguish source development from a usable
member service. No officer collects profiles or changes a roster during review.

**Stop conditions:** a demonstration uses real member records, officer-only
consent is reused, results include private contacts, unavailable saves look
successful, an age-confirmation box is preselected, confirmation is described
as verified age, a minor is included, or anyone claims the code is a live service.

**Success proof:** for now, the recorded synthetic calculation, local account,
membership, storage, bounded recommendations, privacy-control, request-limit and
browser-denial tests, plus separate form/client tests and a fake-service browser
demonstration, plus actual client-to-local-backend request tests. Connected
rendered-browser-to-local-backend checks also pass. Rendered-browser-to-hosted-server
checks, the website's normal sign-in integration, persistent privacy-choice
management, hosted authentication checks and a live pilot remain outstanding.
A specialist is still needed to arrange a demonstration and every release step;
backup officers can review the evidence above without a terminal.

**Undo:** keep the capability unavailable and request a reviewed code revert if
needed. Do not delete member records, grant roles or change billing as a repair.

**Escalation:** platform owner for failures; membership and privacy/security
owners for eligibility, consent or a private report. Use the private incident
channel for sensitive reports, not a public issue or screenshot.
