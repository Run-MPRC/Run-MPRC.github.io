import React from 'react';
import {
  MapContainer, Marker, Popup, TileLayer,
} from 'react-leaflet';
import Route from './Route';

function RouteLeaflet() {
  return (
    <MapContainer
      style={{
        height: '40vh', width: '100%', maxWidth: '800px', zIndex: 0,
      }}
      center={[51.505, -0.09]}
      zoom={11}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Route />
      <Marker position={[51.505, -0.09]}>
        <Popup>
          A pretty CSS3 popup.
          {' '}
          <br />
          {' '}
          Easily customizable.
        </Popup>
      </Marker>
    </MapContainer>
  );
}

export default RouteLeaflet;
