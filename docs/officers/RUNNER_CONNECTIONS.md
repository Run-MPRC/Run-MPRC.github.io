# Finding running partners — NOT AVAILABLE YET

**Purpose:** explain the proposed opt-in member experience and how to review its
development without exposing member records.

**Approver:** Dave Liu for source development. A membership lead and the club's
privacy/security owner must approve the consent, adult eligibility and live pilot.

**Prerequisites:** [issue #689](https://github.com/Run-MPRC/Run-MPRC.github.io/issues/689),
a reviewed implementation, synthetic testing, and the existing protected backend
release. A specialist is still required for implementation and release.

## What works now

Only an internal validator and matching calculation with made-up runners exist.
There is no member form, published card, recommendation service or stored runner
profile. The officer lookup setting does not authorize member discovery.

## Review steps

1. Ask the platform owner for the issue's current source and test record.
2. Confirm any demonstration labels all made-up runners as synthetic.
3. Check that normal run information stays public without a runner profile.
4. Before a pilot, request proof of explicit opt-in, withdrawal, blocking,
   current member access and private-data protection.
5. Request separate website and Firebase deployment evidence before announcing
   the feature. A calculation test or green build is not proof of availability.

**Expected result:** officers can distinguish source development from a usable
member service. No officer collects profiles or changes a roster during review.

**Stop conditions:** a demonstration uses real member records, officer-only
consent is reused, results include private contacts, unavailable saves look
successful, a minor is included without an approved design, or anyone claims
that the current code is a live service.

**Success proof:** for now, the recorded synthetic calculation tests only. The
integrated member and server acceptance tests and live pilot remain outstanding.

**Undo:** keep the capability unavailable and request a reviewed code revert if
needed. Do not delete member records, grant roles or change billing as a repair.

**Escalation:** platform owner for failures; membership and privacy/security
owners for eligibility, consent or a private report. Use the private incident
channel for sensitive reports, not a public issue or screenshot.
