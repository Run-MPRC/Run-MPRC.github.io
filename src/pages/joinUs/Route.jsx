import React from 'react';
import './route.css';

const GOOGLE_MAPS_ROUTE_URL = 'https://www.google.com/maps/dir/37.5741586,-122.3040731/3rd+Avenue+Upper+Launch,+Foster+City,+CA+94404/Bridgeview+Park,+Parks+and+Recreation,+Beach+Park+Blvd,+Foster+City,+CA+94404/3rd+Avenue+Upper+Launch,+Foster+City,+CA+94404/Public+Restrooms+%7C+Seal+Point+Park,+San+Mateo,+CA+94401/@37.5691702,-122.3115204,9688m/data=!3m1!1e3!4m28!4m27!1m1!4e1!1m5!1m1!1s0x808f9ea333a9a057:0xdbe3ef521e618261!2m2!1d-122.2835767!2d37.5745441!1m5!1m1!1s0x808f994a7c77a8df:0xd13b2dc363ab1c81!2m2!1d-122.2620212!2d37.5725052!1m5!1m1!1s0x808f9ea333a9a057:0xdbe3ef521e618261!2m2!1d-122.2835767!2d37.5745441!1m5!1m1!1s0x808f9fadf8f78683:0x1b0c3693727b78da!2m2!1d-122.3046757!2d37.5745301!3e2?entry=ttu';

// Embed the directions route
const GOOGLE_MAPS_EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m28!1m12!1m3!1d25257.5!2d-122.283!3d37.573!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!4m13!3e2!4m5!1s0x808f9fadf8f78683%3A0x1b0c3693727b78da!2sSeal%20Point%20Park!3m2!1d37.5745301!2d-122.3046757!4m5!1s0x808f994a7c77a8df%3A0xd13b2dc363ab1c81!2sBridgeview%20Park%2C%20Foster%20City!3m2!1d37.5725052!2d-122.2620212!5e0!3m2!1sen!2sus!4v1706400000000!5m2!1sen!2sus';

function Route() {
  return (
    <div className="route-container">
      <iframe
        src={GOOGLE_MAPS_EMBED_URL}
        title="MPRC Saturday Morning Route"
        className="route-iframe"
        allowFullScreen=""
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="route-info">
        <p className="route-description">
          <strong>Route:</strong> Seal Point Park → 3rd Ave Launch → Bridgeview Park → back
        </p>
        <p className="route-distance">
          <strong>Distance:</strong> ~5 miles out and back along the Bay Trail
        </p>
      </div>
      <a
        href={GOOGLE_MAPS_ROUTE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="btn route-btn"
      >
        View Full Route on Google Maps
      </a>
    </div>
  );
}

export default Route;
