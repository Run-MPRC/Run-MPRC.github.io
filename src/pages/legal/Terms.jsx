import React from 'react';
import SEO from '../../components/SEO';

function Terms() {
  return (
    <>
      <SEO
        title="Terms of Service"
        description="Terms of service for Mid-Peninsula Running Club"
        url="https://runmprc.com/terms"
        canonicalUrl="https://runmprc.com/terms"
      />
      <div className="container mx-auto p-6 max-w-3xl prose">
        <h1 className="text-3xl font-bold mb-4">Terms of Service</h1>
        <p className="text-sm text-gray-600">Last updated: <strong>REPLACE WITH DATE</strong></p>

        <p className="mt-4 p-3 bg-amber-100 border border-amber-300 rounded">
          <strong>Placeholder template.</strong> Before going live, replace this content
          with terms reviewed by an attorney or generated from a reputable service
          (iubenda, Termly, Rocket Lawyer). Specific clauses you&apos;ll want to include:
          event cancellation and refund policy, liability waiver reference, payment
          dispute resolution, intellectual property, account termination, and
          governing law (California).
        </p>

        <h2 className="text-xl font-semibold mt-6">1. Acceptance of terms</h2>
        <p>
          By using runmprc.com (the &quot;Site&quot;) you agree to these Terms. If you
          don&apos;t agree, don&apos;t use the Site.
        </p>

        <h2 className="text-xl font-semibold mt-6">2. Accounts</h2>
        <p>
          You must provide accurate information and keep your password secure. You&apos;re
          responsible for activity on your account.
        </p>

        <h2 className="text-xl font-semibold mt-6">3. Event registrations and payments</h2>
        <p>
          Registration fees for club events are processed by Stripe. Refund policies for
          specific events are posted on each event page. Mid-Peninsula Running Club may
          cancel or reschedule events; in such cases, refunds will be issued at the
          club&apos;s discretion less Stripe processing fees.
        </p>

        <h2 className="text-xl font-semibold mt-6">4. Assumption of risk</h2>
        <p>
          Running is an inherently risky activity. By registering for an event you
          confirm that you have read and accepted the event-specific waiver and assume
          all risks of participation.
        </p>

        <h2 className="text-xl font-semibold mt-6">5. Changes</h2>
        <p>
          We may update these Terms; material changes will be posted here. Continued use
          after changes means you accept the updated Terms.
        </p>

        <h2 className="text-xl font-semibold mt-6">6. Contact</h2>
        <p>
          Questions about these Terms: contact us via the{' '}
          <a href="/contact" className="text-blue-600 underline">contact page</a>.
        </p>
      </div>
    </>
  );
}

export default Terms;
