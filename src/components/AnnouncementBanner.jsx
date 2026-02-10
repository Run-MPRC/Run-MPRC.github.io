import React from 'react';

function AnnouncementBanner() {
  // Hide banner after Saturday 2/14/2026 (end of day Pacific time)
  const expirationDate = new Date('2026-02-15T00:00:00-08:00');
  if (new Date() >= expirationDate) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '5.5rem',
        left: 0,
        width: '100vw',
        zIndex: 98,
        backgroundColor: '#dc2626',
        color: 'white',
        textAlign: 'center',
        padding: '0.75rem 1rem',
        fontWeight: 'bold',
        fontSize: '1rem',
      }}
    >
      Important: On Saturday 2/14, we will meet at Baywinds Park instead of
      Seal Point Park due to an event at Seal Point. Plenty of parking is
      available at Baywinds Park.
    </div>
  );
}

export default AnnouncementBanner;
