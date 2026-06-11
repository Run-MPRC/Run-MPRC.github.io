import React from 'react';
import SEO from '../../components/SEO';

function Privacy() {
  return (
    <>
      <SEO
        title="Privacy Policy"
        description="Privacy policy for Mid-Peninsula Running Club"
        url="https://runmprc.com/privacy"
        canonicalUrl="https://runmprc.com/privacy"
      />
      <div className="container mx-auto p-6 max-w-3xl prose">
        <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
        <p className="text-sm text-gray-600">Last updated: <strong>REPLACE WITH DATE</strong></p>

        <p className="mt-4 p-3 bg-amber-100 border border-amber-300 rounded">
          <strong>Placeholder template.</strong> Before going live, replace this with a
          policy reviewed by counsel or generated from a reputable service. If you
          accept registrations from California residents you may have CCPA obligations.
        </p>

        <h2 className="text-xl font-semibold mt-6">What we collect</h2>
        <ul className="list-disc pl-5">
          <li>
            <strong>Account info:</strong> name, email, phone, role (member, admin,
            unverified).
          </li>
          <li>
            <strong>Registration info:</strong> name, email, phone, date of birth,
            emergency contact, shirt size, event-specific responses, waiver acceptance.
          </li>
          <li>
            <strong>Payment info:</strong> handled entirely by Stripe. MPRC does not
            see or store your card details. We receive a Stripe payment reference only.
          </li>
          <li>
            <strong>Analytics:</strong> Firebase Analytics (anonymized usage) and
            basic server logs.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">How we use it</h2>
        <ul className="list-disc pl-5">
          <li>To process your registrations and communicate about events</li>
          <li>To verify your membership status and apply member pricing</li>
          <li>To notify you of MPRC activity you&apos;ve opted into</li>
          <li>For emergency contact purposes during events</li>
          <li>For internal record-keeping required by our insurance and bylaws</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Who we share it with</h2>
        <ul className="list-disc pl-5">
          <li>
            <strong>Stripe</strong> — payment processing (subject to Stripe&apos;s Privacy Policy)
          </li>
          <li>
            <strong>Google Firebase</strong> — hosting, auth, database, email delivery
          </li>
          <li>
            <strong>SendGrid / similar</strong> — transactional email delivery
          </li>
        </ul>
        <p>We do not sell your personal information.</p>

        <h2 className="text-xl font-semibold mt-6">Your rights</h2>
        <p>
          You can view and edit your profile data at{' '}
          <a href="/account" className="text-blue-600 underline">runmprc.com/account</a>.
          Contact us to request deletion of your account and associated registration data.
        </p>

        <h2 className="text-xl font-semibold mt-6">Contact</h2>
        <p>
          Questions: contact us via the{' '}
          <a href="/contact" className="text-blue-600 underline">contact page</a>.
        </p>
      </div>
    </>
  );
}

export default Privacy;
