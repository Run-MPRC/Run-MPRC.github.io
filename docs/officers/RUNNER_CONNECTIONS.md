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

An internal matching calculation and private profile-storage code pass tests
with made-up runners in a local test database. There is no member form, published
card or connected recommendation service. Nothing in this change is deployed.
The officer lookup setting does not authorize member discovery.

The planned form will ask members to confirm they are 18 or older. It will not
collect a birth date or claim to verify age or identity. The box must start
unchecked. Withdrawal clears the confirmation, so joining again requires a new
confirmation. Club membership must still be checked separately by the server.

## Review steps

1. Ask the platform owner for the issue's current source and test record.
2. Confirm any demonstration labels all made-up runners as synthetic.
3. Check that normal run information stays public without a runner profile.
4. Before a pilot, request proof of explicit opt-in, withdrawal, blocking,
   current member access, the unchecked 18+ confirmation and private-data protection.
5. Request separate website and Firebase deployment evidence before announcing
   the feature. A calculation test or green build is not proof of availability.

**Expected result:** officers can distinguish source development from a usable
member service. No officer collects profiles or changes a roster during review.

**Stop conditions:** a demonstration uses real member records, officer-only
consent is reused, results include private contacts, unavailable saves look
successful, an age-confirmation box is preselected, confirmation is described
as verified age, a minor is included, or anyone claims the code is a live service.

**Success proof:** for now, the recorded synthetic calculation, local storage
and browser-denial tests. Integrated member/server tests and a live pilot remain
outstanding. A specialist is still needed for every implementation/release step.

**Undo:** keep the capability unavailable and request a reviewed code revert if
needed. Do not delete member records, grant roles or change billing as a repair.

**Escalation:** platform owner for failures; membership and privacy/security
owners for eligibility, consent or a private report. Use the private incident
channel for sensitive reports, not a public issue or screenshot.
