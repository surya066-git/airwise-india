"use client";

import { ArrowRight, LocateFixed, MapPin, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { useDialogFocus } from "@/components/use-dialog-focus";

export type LocationChoice = { city: string; latitude: number | null; longitude: number | null };

export default function LocationDialog({
  initial, onClose, onApply
}: {
  initial: LocationChoice;
  onClose: () => void;
  onApply: (choice: LocationChoice) => void;
}) {
  const [city, setCity] = useState(initial.city);
  const [latitude, setLatitude] = useState(initial.latitude === null ? "" : String(initial.latitude));
  const [longitude, setLongitude] = useState(initial.longitude === null ? "" : String(initial.longitude));
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const hasLat = latitude.trim() !== "";
    const hasLon = longitude.trim() !== "";
    if (hasLat !== hasLon) {
      setError("Enter both coordinates, or leave both blank.");
      return;
    }
    if (!city.trim() && !hasLat) {
      setError("Enter a city or add coordinates to choose your location.");
      return;
    }
    const lat = hasLat ? Number(latitude) : null;
    const lon = hasLon ? Number(longitude) : null;
    if (hasLat && hasLon && (
      !Number.isFinite(lat) || lat! < -90 || lat! > 90 ||
      !Number.isFinite(lon) || lon! < -180 || lon! > 180
    )) {
      setError("Check that the latitude and longitude are valid.");
      return;
    }
    onApply({ city: city.trim().slice(0, 100), latitude: lat, longitude: lon });
  }

  function useCurrentLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("This browser does not support location detection.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => onApply({
        city: city.trim(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }),
      () => setError("Location permission was unavailable. You can enter coordinates manually."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="location-dialog-title" aria-describedby="location-dialog-copy">
        <button className="dialog-close" aria-label="Close location settings" onClick={onClose}><X size={18} /></button>
        <span className="dialog-icon"><MapPin size={20} /></span>
        <div className="eyebrow"><span /> Location</div>
        <h2 id="location-dialog-title">Choose your area</h2>
        <p className="dialog-copy" id="location-dialog-copy">The CPCB data.gov.in feed is filtered by city. Choose a city for official readings; coordinates can narrow station matching and find nearby OpenAQ measurements.</p>
        <form className="dialog-form" onSubmit={submit}>
          <label htmlFor="city-name">City or town <small>Needed for official CPCB data.gov.in matching</small></label>
          <input id="city-name" value={city} onChange={(event) => setCity(event.target.value)} maxLength={100} placeholder="For example, Pune" />
          <div className="coordinate-heading">Coordinates <small>Optional; refine CPCB matching within 50 km and find OpenAQ readings within 25 km</small></div>
          <div className="coordinate-row">
            <div><label htmlFor="latitude">Latitude</label><input id="latitude" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="18.5204" /></div>
            <div><label htmlFor="longitude">Longitude</label><input id="longitude" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="73.8567" /></div>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="geolocate-button" type="button" onClick={useCurrentLocation}><LocateFixed size={16} /> Use my current location</button>
          <div className="dialog-actions">
            <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Use this location <ArrowRight size={15} /></button>
          </div>
        </form>
      </section>
    </div>
  );
}
