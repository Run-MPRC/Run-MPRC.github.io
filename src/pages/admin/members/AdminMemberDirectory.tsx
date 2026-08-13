import React from 'react';
import { Link } from 'react-router-dom';
import '../../../assets/styles/memberDirectoryPreview.css';
import SEO from '../../../components/SEO';
import AdminGuard from '../AdminGuard';

function PeopleFinderPreview() {
  return (
    <div className="container">
      <section
        className="member-directory-preview member-directory-admin-preview"
        aria-labelledby="member-directory-admin-preview-heading"
      >
        <SEO title="Admin — People finder" noindex />
        <Link to="/admin" className="member-directory-preview__back-link">
          ← Admin home
        </Link>
        <h1 id="member-directory-admin-preview-heading">People finder</h1>
        <p>
          When connected, authorized officers will be able to search by the
          beginning of a person&apos;s current display name or any name part. Only
          website-account holders who turned on the optional finder could appear.
          A result will not prove membership, payment, eligibility, or a website role.
        </p>
        <p>
          Photos will be voluntary. This page will not accept a photo as a query
          or use facial recognition, image matching, fuzzy matching, or a full
          account list.
        </p>

        <div
          id="member-directory-admin-preview-status"
          className="member-directory-preview__status"
          role="status"
        >
          <strong>Interface preview — search is not connected.</strong>
          <span>
            No finder name is collected or sent, and no member-directory profiles
            or results are loaded.
          </span>
        </div>

        <form
          className="member-directory-preview__search-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="member-directory-preview__search-row">
            <label
              htmlFor="member-directory-name-query-preview"
              className="member-directory-preview__search-label"
            >
              <span id="member-directory-admin-query-label">
                Search opted-in people by name
              </span>
              <span id="member-directory-admin-query-help">
                Name entry will be available after the protected backend is connected.
              </span>
              <input
                id="member-directory-name-query-preview"
                className="member-directory-preview__search-input"
                type="text"
                value=""
                disabled
                readOnly
                autoComplete="off"
                aria-labelledby="member-directory-admin-query-label"
                aria-describedby="member-directory-admin-preview-status member-directory-admin-query-help"
              />
            </label>
            <button
              className="member-directory-preview__search-button"
              type="submit"
              disabled
              aria-describedby="member-directory-admin-preview-status"
            >
              Search
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function AdminMemberDirectory() {
  return (
    <AdminGuard>
      <PeopleFinderPreview />
    </AdminGuard>
  );
}
