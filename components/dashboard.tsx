"use client";

import {
  Activity, ArrowRight, Clock3, ExternalLink, HeartPulse, Leaf,
  MapPin, RefreshCw, ShieldCheck, Sparkles, Users, Wind
} from "lucide-react";
import { useEffect, useState } from "react";
import AssistantPanel from "@/components/assistant-panel";
import LocationDialog, { type LocationChoice } from "@/components/location-dialog";
import PreferencesDialog from "@/components/preferences-dialog";
import RecommendationCards from "@/components/recommendations";
import type { AirQualityResponse, DataStatus, PollutantReading } from "@/types/air-quality";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/types/preferences";
import { airQualityResponseSchema, normalizePreferences } from "@/lib/validation/schemas";

const EMPTY_LOCATION: LocationChoice = { city: "", latitude: null, longitude: null };
const STATUS: Record<DataStatus, string> = {
  live: "Live reading", stale: "Stale reading", unavailable: "Unavailable",
  unverified: "Needs verification", not_configured: "Setup needed"
};

function StatusPill({ status }: { status: DataStatus }) {
  return <span className={`status-pill status-${status}`}><i />{STATUS[status]}</span>;
}

function timeLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata"
  }).format(date) + " IST";
}

function ageLabel(value: string | null) {
  if (!value) return "age unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "age unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function readingFor(items: PollutantReading[], name: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string[]> = { O3: ["O3", "OZONE"] };
  const names = aliases[name] ?? [name];
  return items.find((item) => names.some((candidate) => normalize(item.parameter) === normalize(candidate)));
}

function valueLabel(item?: PollutantReading) {
  return item ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(item.value) : "—";
}

export default function Dashboard() {
  const [location, setLocation] = useState<LocationChoice>(EMPTY_LOCATION);
  const [air, setAir] = useState<AirQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationOpen, setLocationOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [notice, setNotice] = useState("");

  async function refresh(nextLocation: LocationChoice) {
    setLoading(true);
    const params = new URLSearchParams();
    if (nextLocation.city) params.set("city", nextLocation.city);
    if (nextLocation.latitude !== null && nextLocation.longitude !== null) {
      params.set("latitude", String(nextLocation.latitude));
      params.set("longitude", String(nextLocation.longitude));
    }
    try {
      const response = await fetch(`/api/aqi?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Data service unavailable");
      const payload: unknown = await response.json();
      const validated = airQualityResponseSchema.safeParse(payload);
      if (!validated.success) throw new Error("Data service returned an invalid response");
      setAir(validated.data);
      setNotice("");
    } catch {
      setAir((previous) => previous ? {
        ...previous,
        official: previous.official.aqi === null ? previous.official : {
          ...previous.official,
          status: "stale",
          message: "Refresh failed. The previous CPCB observation is retained and marked stale."
        },
        supplementary: previous.supplementary.measurements.length === 0 ? previous.supplementary : {
          ...previous.supplementary,
          status: "stale",
          message: "Refresh failed. The previous OpenAQ observations are retained and marked stale."
        }
      } : null);
      setNotice("The data service could not be reached. No current AQI is available.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let restored = EMPTY_LOCATION;
      try {
        const locationJson = localStorage.getItem("airwise-location");
        if (locationJson) {
          const saved = JSON.parse(locationJson) as Partial<LocationChoice>;
          if (typeof saved.city === "string") {
            restored = {
              city: saved.city.slice(0, 100),
              latitude: typeof saved.latitude === "number" ? saved.latitude : null,
              longitude: typeof saved.longitude === "number" ? saved.longitude : null
            };
          }
        }
        const preferencesJson = localStorage.getItem("airwise-profile");
        if (preferencesJson) {
          setPreferences(normalizePreferences(JSON.parse(preferencesJson)));
        }
      } catch {
        localStorage.removeItem("airwise-location");
        localStorage.removeItem("airwise-profile");
      }
      setLocation(restored);
      void refresh(restored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function applyLocation(next: LocationChoice) {
    setLocation(next);
    setAir(null);
    localStorage.setItem("airwise-location", JSON.stringify(next));
    setLocationOpen(false);
    void refresh(next);
  }

  function applyPreferences(next: UserPreferences) {
    setPreferences(next);
    localStorage.setItem("airwise-profile", JSON.stringify(next));
    setPreferencesOpen(false);
  }

  const official = air?.official;
  const supplementary = air?.supplementary;
  const insight = official?.aqi === null || official?.aqi === undefined
    ? "A verified reading has not arrived for this location. Use practical habits while we keep the data honest."
    : "Use the station reading as one signal for your day. Your plan can reflect your routine and the people you care for.";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="AIRWISE INDIA home">
          <span className="brand-icon"><Wind size={20} /></span>
          <span className="brand-copy"><strong>AIRWISE</strong><small>INDIA</small></span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a className="active" href="#overview">Overview</a>
          <a href="#recommendations">Your plan</a>
          <a href="#assistant">Ask AIRWISE</a>
        </nav>
        <div className="top-actions">
          <button className="location-button" onClick={() => setLocationOpen(true)}>
            <MapPin size={16} /><span>{location.city || (location.latitude !== null ? "Current location" : "Choose location")}</span><span className="chevron">⌄</span>
          </button>
          <button className="profile-button" onClick={() => setPreferencesOpen(true)}><Users size={16} /> Personalize</button>
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="page-heading" id="overview">
          <div>
            <div className="eyebrow"><span /> AIR QUALITY, MADE PERSONAL</div>
            <h1>Your day, in a clearer light.</h1>
            <p>Understand the air around you and make a plan that fits real life.</p>
          </div>
          <button className="refresh-button" onClick={() => void refresh(location)} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />{loading ? "Checking sources" : "Refresh data"}
          </button>
        </section>

        <div className="dashboard-grid">
          <section className="aqi-card" aria-labelledby="aqi-title">
            <div className="aqi-card-top">
              <div>
                <div className="card-kicker"><Activity size={14} /> OFFICIAL AIR QUALITY</div>
                <h2 id="aqi-title">{location.city || official?.city || "Your neighbourhood"}</h2>
                <p>{official?.state ? `${official.state}, India` : location.city ? "India" : "Select a city or use your current location"}</p>
              </div>
              {loading ? <span className="status-pill status-unavailable" role="status"><i />Checking sources</span>
                : <StatusPill status={official?.status ?? "unavailable"} />}
            </div>
            <div className="aqi-main-row">
              <div className="aqi-number-wrap">
                <span className="aqi-number">{loading ? "…" : official?.aqi ?? "—"}</span>
                <span className="aqi-unit">INDIA AQI</span>
              </div>
              <div className="aqi-summary">
                <span className={official?.category ? "category-label" : "category-label muted"}>{official?.category ?? "No verified index"}</span>
                <p>{official?.interpretation ?? official?.message ?? "Checking the configured CPCB source. Current readings are never estimated."}</p>
                {official?.station && <span className="station-line"><MapPin size={14} />{official.station}{official.city ? " · " + official.city : ""}</span>}
                {official?.distanceMeters !== null && official?.distanceMeters !== undefined && <span className="station-line"><MapPin size={14} />{new Intl.NumberFormat("en-IN").format(official.distanceMeters)} m from selected location</span>}
                {timeLabel(official?.updatedAt ?? null) && <span className="station-line"><Clock3 size={14} />Updated {timeLabel(official?.updatedAt ?? null)}</span>}
                {official?.updatedAt && <span className="station-line">Observation age: {ageLabel(official.updatedAt)}</span>}
                {official?.pagination && <span className="station-line" role="status">
                  CPCB pagination {official.pagination.status === "complete" ? "verified" : "unverified"}: {official.pagination.uniqueRecords}
                  {official.pagination.reportedTotal === null ? " records observed" : ` of ${official.pagination.reportedTotal} reported`}
                  {official.pagination.duplicateRows > 0 ? ` · ${official.pagination.duplicateRows} repeated row(s)` : ""}
                  {official.pagination.conflictingRows > 0 ? ` · ${official.pagination.conflictingRows} conflicting row(s)` : ""}
                  {` · ${official.pagination.pageCount} page request(s)`}
                </span>}
              </div>
            </div>
            <div className="aqi-card-footer">
              <div className="source-mark"><span><ShieldCheck size={15} /></span><div><strong>Source</strong><small>CPCB via data.gov.in</small></div></div>
              <a className="source-link" href="https://www.data.gov.in/catalog/real-time-air-quality-index" target="_blank" rel="noreferrer">Data details <ExternalLink size={13} /></a>
            </div>
            <div className="card-orbit orbit-one" aria-hidden="true" /><div className="card-orbit orbit-two" aria-hidden="true" />
          </section>

          <aside className="side-stack">
            <section className="insight-card">
              <span className="insight-icon"><Sparkles size={17} /></span>
              <div className="insight-copy"><div className="card-kicker">TODAY&apos;S AIRWISE NOTE</div>
                <h2>{official?.aqi === null || official?.aqi === undefined ? "Start with what we know." : "Make the reading useful."}</h2>
                <p>{insight}</p>
                <button className="text-button" onClick={() => document.getElementById("assistant")?.scrollIntoView({ behavior: "smooth" })}>Ask about your day <ArrowRight size={15} /></button>
              </div>
              <span className="leaf-illustration" aria-hidden="true"><Leaf size={72} strokeWidth={1.1} /></span>
            </section>
            <section className="profile-strip">
              <span className="profile-strip-icon"><HeartPulse size={17} /></span>
              <span className="profile-strip-copy"><strong>{preferences.occupation === "Resident" ? "Make advice fit your day" : `Plan for a ${preferences.occupation.toLowerCase()}`}</strong><small>{preferences.children || preferences.olderAdults ? "Household preferences saved" : "Optional preferences · no health history"}</small></span>
              <button className="icon-button" aria-label="Edit personal preferences" onClick={() => setPreferencesOpen(true)}><ArrowRight size={17} /></button>
            </section>
          </aside>
        </div>

        <section className="section-block" aria-labelledby="pollutant-title">
          <div className="section-heading">
            <div><div className="eyebrow"><span /> STATION DETAILS</div><h2 id="pollutant-title">What is in the reading</h2></div>
            <span className="section-caption">CPCB observations only · no AQI estimates</span>
          </div>
          <div className="pollutant-grid">
            {[
              ["PM2.5", "Fine particles", "mint"], ["PM10", "Coarse particles", "peach"],
              ["NO2", "Nitrogen dioxide", "blue"], ["O3", "Ozone", "lilac"],
              ["SO2", "Sulphur dioxide", "yellow"], ["CO", "Carbon monoxide", "rose"]
            ].map(([code, label, color]) => {
              const reading = readingFor(official?.pollutants ?? [], code);
              return <article className="pollutant-card" key={code}>
                <span className={`pollutant-symbol ${color}`}>{code}</span><span className="pollutant-name">{label}</span>
                <strong>{valueLabel(reading)} <small>{reading?.unit ?? (reading ? "" : "No reading")}</small></strong>
                {reading?.measuredAt && <span className="pollutant-time">{timeLabel(reading.measuredAt)}</span>}
              </article>;
            })}
          </div>
          <p className="data-note"><ShieldCheck size={15} />{official?.message ?? "Pollutant values appear only when returned by the selected CPCB source."}</p>
        </section>

        <section className="section-block" id="recommendations">
          <div className="section-heading">
            <div><div className="eyebrow"><span /> SMALL STEPS, REAL ROUTINES</div><h2>A plan that travels with you</h2><p className="section-intro">Standard rule-based guidance, not AI-generated. Practical ideas without invented impact numbers.</p></div>
            <button className="outline-button" onClick={() => setPreferencesOpen(true)}>Tune your plan <ArrowRight size={15} /></button>
          </div>
          <RecommendationCards preferences={preferences} air={air} onAsk={(prompt) => {
            document.getElementById("assistant")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.dispatchEvent(new CustomEvent("airwise:prompt", { detail: prompt }));
          }} />
          <p className="recommendation-source"><ShieldCheck size={14} />General exposure-reduction and pollution-prevention guidance. These ideas do not replace local public-health advice.</p>
        </section>

        <section className="section-block" aria-labelledby="supplementary-title">
          <div className="section-heading compact-heading">
            <div><div className="eyebrow"><span /> SUPPLEMENTARY SOURCE</div><h2 id="supplementary-title">Nearby sensor measurements</h2></div>
            <StatusPill status={supplementary?.status ?? "not_configured"} />
          </div>
          <div className="supplementary-card">
            <div className="supplementary-intro"><span className="openaq-mark"><Activity size={18} /></span>
              <div><strong>{supplementary?.station ?? "OpenAQ sensor network"}</strong><small>{supplementary?.distanceMeters !== null && supplementary?.distanceMeters !== undefined
                ? `Nearest reference monitor · ${new Intl.NumberFormat("en-IN").format(supplementary.distanceMeters)} m away`
                : supplementary?.message ?? "Coordinates and an OpenAQ key are needed to search nearby."}</small></div>
            </div>
            {supplementary?.measurements.length ? <div className="supplementary-values">
              {supplementary.measurements.slice(0, 5).map((item, index) => <div key={`${item.parameter}-${index}`}>
                <span>{item.parameter}</span><strong>{valueLabel(item)} <small>{item.unit}</small></strong>
                <small>{(item.freshness === "stale" ? "Stale historical · " : item.freshness === "unverified" ? "Unverified · " : "Fresh · ") + (item.measuredAt ? timeLabel(item.measuredAt) + " · " + ageLabel(item.measuredAt) : "Time unavailable · age unavailable")}</small>
              </div>)}
              <span className="supplementary-updated">Each sensor is reported at its own observation time.</span>
            </div> : <div className="supplementary-empty"><b>—</b><span>No nearby measurement to show</span></div>}
          </div>
          <p className="data-note"><Activity size={15} />OpenAQ values are raw sensor observations. AIRWISE never labels them as a CPCB AQI.</p>
        </section>

        <AssistantPanel location={location} preferences={preferences} />
        <footer className="page-footer"><a href="#top" className="footer-brand"><span className="brand-icon"><Wind size={16} /></span>AIRWISE INDIA</a><p>Breathe smarter. Live better.</p><span>Built around transparency, not guesses.</span></footer>
        {notice && <p className="floating-notice" role="status">{notice}</p>}
      </main>

      {locationOpen && <LocationDialog initial={location} onClose={() => setLocationOpen(false)} onApply={applyLocation} />}
      {preferencesOpen && <PreferencesDialog initial={preferences} onClose={() => setPreferencesOpen(false)} onSave={applyPreferences} />}
    </div>
  );
}
