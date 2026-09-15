import React from 'react';

const SEPTEMBER_19_END = new Date('2026-09-20T00:00:00-07:00');
const SEPTEMBER_26_END = new Date('2026-09-27T00:00:00-07:00');

const SEAL_POINT_DOG_PARK_RESTROOMS_URL = 'https://www.google.com/maps/search/?api=1&query=37.5733685%2C-122.3007770';
const BAYWINDS_KITE_SCHOOL_URL = 'https://maps.app.goo.gl/eWoXjkF2Brt8ujh88';

function AnnouncementBanner() {
  const now = new Date();
  const showSeptember19 = now < SEPTEMBER_19_END;
  const showSeptember26 = now < SEPTEMBER_26_END;

  if (!showSeptember19 && !showSeptember26) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Temporary Saturday meeting locations"
      style={{
        position: 'relative',
        top: 'var(--site-nav-height)',
        left: 0,
        width: '100%',
        zIndex: 98,
        backgroundColor: '#dc2626',
        color: 'white',
        padding: '0.75rem 1rem',
        fontSize: '1rem',
      }}
    >
      <div style={{ maxWidth: '72rem', margin: '0 auto' }}>
        <strong>Temporary Saturday meeting locations</strong>
        <ul style={{ margin: '0.35rem 0 0' }}>
          {showSeptember19 && (
            <li>
              <strong>Sept. 19, 8:45 AM:</strong>
              {' '}
              Meet at the
              {' '}
              <a
                href={SEAL_POINT_DOG_PARK_RESTROOMS_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'underline' }}
              >
                restrooms next to the Seal Point dog park
              </a>
              . Parking may be limited, so allow extra time.
            </li>
          )}
          {showSeptember26 && (
            <li>
              <strong>Sept. 26, 8:45 AM:</strong>
              {' '}
              Meet at
              {' '}
              <a
                href={BAYWINDS_KITE_SCHOOL_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'underline' }}
              >
                The Kite School in Baywinds Park
              </a>
              , 30 Lakeside Drive, Foster City, for the run and social. Gather
              on the artificial turf south of the restrooms, toward the San
              Mateo Bridge.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

export default AnnouncementBanner;
