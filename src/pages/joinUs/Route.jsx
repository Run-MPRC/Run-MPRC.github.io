import React, { useEffect, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from 'react-leaflet';
import GPXParser from 'gpxparser';
import route from './route.gpx';
import theme from '../../theme';

function Route() {
  const [polylinePositions, setPolylinePositions] = useState([]);
  useEffect(() => {
    fetch(route)
      .then((r) => r.text())
      .then((text) => {
        const gpx = new GPXParser();
        gpx.parse(text);
        // Assuming you want to extract coordinates from the first track
        const positions = gpx.tracks[0].points.map((point) => [
          point.lat,
          point.lon,
        ]);
        setPolylinePositions(positions);
      });
  }, []);

  return (
    <MapContainer
      style={{
        height: '400px', width: '100%', maxWidth: '800px', zIndex: 1,
      }}
      center={[37.573, -122.283]}
      zoom={13}
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[37.5741586, -122.3040731]}>
        <Popup>Start/End: Seal Point Park</Popup>
      </Marker>
      <Marker position={[37.5725052, -122.2620212]}>
        <Popup>Turnaround: Bridgeview Park</Popup>
      </Marker>
      {polylinePositions.length > 0 && (
        <Polyline
          pathOptions={{ color: theme.palette.primary.main }}
          positions={polylinePositions}
        />
      )}
    </MapContainer>
  );
}

export default Route;
