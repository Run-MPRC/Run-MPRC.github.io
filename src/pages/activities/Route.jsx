import React, { useEffect, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import route from "./route.gpx";
import GPXParser from "gpxparser";
import theme from "../../theme";

export const Route = () => {
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
      style={{ height: "400px", width: "800px" }}
      center={[37.57236641, -122.28687946]}
      zoom={14}
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[37.57401089, -122.302166]}>
        <Popup>Starting Location</Popup>
      </Marker>
      {polylinePositions.length > 0 && (
        <Polyline
          pathOptions={{ color: theme.palette.primary.main }}
          positions={polylinePositions}
        />
      )}
    </MapContainer>
  );
};
