import React from 'react';
import './route.css';

const GOOGLE_MAPS_ROUTE_URL = 'https://www.google.com/maps/dir/37.5741586,-122.3040731/3rd+Avenue+Upper+Launch,+Foster+City,+CA+94404/Bridgeview+Park,+Parks+and+Recreation,+Beach+Park+Blvd,+Foster+City,+CA+94404/3rd+Avenue+Upper+Launch,+Foster+City,+CA+94404/Public+Restrooms+%7C+Seal+Point+Park,+San+Mateo,+CA+94401/@37.5691702,-122.3115204,9688m/data=!3m1!1e3!4m28!4m27!1m1!4e1!1m5!1m1!1s0x808f9ea333a9a057:0xdbe3ef521e618261!2m2!1d-122.2835767!2d37.5745441!1m5!1m1!1s0x808f994a7c77a8df:0xd13b2dc363ab1c81!2m2!1d-122.2620212!2d37.5725052!1m5!1m1!1s0x808f9ea333a9a057:0xdbe3ef521e618261!2m2!1d-122.2835767!2d37.5745441!1m5!1m1!1s0x808f9fadf8f78683:0x1b0c3693727b78da!2m2!1d-122.3046757!2d37.5745301!3e2?entry=ttu';

// Embed URL - shows the route on Google Maps
const GOOGLE_MAPS_EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m46!1m12!1m3!1d12629.008896498045!2d-122.29360700000001!3d37.5724003!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!4m31!3e2!4m3!3m2!1d37.5741586!2d-122.3040731!4m5!1s0x808f9ea333a9a057%3A0xdbe3ef521e618261!2s3rd%20Avenue%20Upper%20Launch%2C%20Foster%20City%2C%20CA%2094404!3m2!1d37.5745441!2d-122.2835767!4m5!1s0x808f994a7c77a8df%3A0xd13b2dc363ab1c81!2sBridgeview%20Park%2C%20Beach%20Park%20Blvd%2C%20Foster%20City%2C%20CA%2094404!3m2!1d37.5725052!2d-122.2620212!4m5!1s0x808f9ea333a9a057%3A0xdbe3ef521e618261!2s3rd%20Avenue%20Upper%20Launch%2C%20Foster%20City%2C%20CA%2094404!3m2!1d37.5745441!2d-122.2835767!4m5!1s0x808f9fadf8f78683%3A0x1b0c3693727b78da!2sPublic%20Restrooms%20%7C%20Seal%20Point%20Park%2C%20San%20Mateo%2C%20CA%2094401!3m2!1d37.5745301!2d-122.3046757!5e1!3m2!1sen!2sus!4v1706300000000!5m2!1sen!2sus';

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
