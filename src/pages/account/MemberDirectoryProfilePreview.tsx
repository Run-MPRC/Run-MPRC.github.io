import React from 'react';
import '../../assets/styles/memberDirectoryPreview.css';

export default function MemberDirectoryProfilePreview({
  hasDisplayName,
}: {
  hasDisplayName: boolean;
}) {
  return (
    <section
      className="member-directory-preview member-directory-profile-preview"
      aria-labelledby="member-directory-profile-preview-heading"
    >
      <h2 id="member-directory-profile-preview-heading">
        Profile photo and officer finder
      </h2>
      <div
        id="member-directory-profile-preview-status"
        className="member-directory-preview__status"
        role="status"
      >
        <strong>Interface preview — not connected yet.</strong>
        <span>
          No directory photo or finder setting is read, uploaded, searched, or
          saved from this preview.
        </span>
      </div>

      <p>
        When connected, you will be able to add an optional profile photo.
        Uploading, replacing, or removing it will not turn on the officer finder.
      </p>
      <p id="member-directory-profile-preview-privacy">
        When connected, authorized officers will be able to search by name and
        see a voluntary thumbnail only after you turn on the separate finder
        choice. A result will not prove current club membership, payment, or
        eligibility. The finder will not accept a photo as a query or use facial
        recognition or image matching.
      </p>

      <div className="member-directory-preview__controls">
        <div className="member-directory-preview__photo-row">
          <div
            className="member-directory-preview__photo-placeholder"
            role="img"
            aria-label="Profile photo preview"
          >
            Photo preview
          </div>
          <div className="member-directory-preview__photo-actions">
            <span
              id="member-directory-photo-preview-label"
              className="member-directory-preview__label"
            >
              Add profile photo (not available yet)
            </span>
            <input
              id="member-directory-photo-preview-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled
              aria-labelledby="member-directory-photo-preview-label"
              aria-describedby="member-directory-profile-preview-status member-directory-photo-preview-help member-directory-profile-preview-privacy"
            />
            <span id="member-directory-photo-preview-help">
              JPG, PNG, or WebP up to 2 MiB will be supported after the protected
              backend is connected.
            </span>
          </div>
        </div>

        <div className="member-directory-preview__visibility">
          <label htmlFor="member-directory-searchable-preview">
            <input
              id="member-directory-searchable-preview"
              type="checkbox"
              checked={false}
              disabled
              readOnly
              aria-describedby={[
                'member-directory-profile-preview-status',
                'member-directory-profile-preview-privacy',
                !hasDisplayName ? 'member-directory-name-required-preview' : null,
              ].filter(Boolean).join(' ')}
            />
            Let authorized officers find me by name (not available yet)
          </label>
          {!hasDisplayName && (
            <p id="member-directory-name-required-preview">
              A full name in the Profile section will also be required when the
              finder is connected.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
