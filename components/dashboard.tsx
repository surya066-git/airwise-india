"use client";

import {
  Activity, ArrowRight, Clock3, ExternalLink, MapPin, Menu, RefreshCw,
  ShieldCheck, Users, Wind, X
} from "lucide-react";
import { useEffect, useState } from "react";
import AssistantPanel from "@/components/assistant-panel";
import LocationDialog, { type LocationChoice } from "@/components/location-dialog";
import PreferencesDialog from "@/components/preferences-dialog";
import RecommendationCards from "@/components/recommendations";
import type { AirQualityResponse, DataStatus, PollutantReading } from "@/types/air-quality";
import { buildRecommendations } from "@/lib/recommendations/engine";
import type { Recommendation, UserPreferenceKey } from "@/types/recommendation";
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

function selectedPreferencesLabel(preferences: UserPreferences) {
  const selected: string[] = [];
  if (preferences.ageGroup !== "Prefer not to say") selected.push(preferences.ageGroup);
  if (preferences.occupation !== "Resident") selected.push(preferences.occupation);
  if (preferences.commute !== "Not applicable") selected.push(preferences.commute);
  if (preferences.outdoorActivity !== "Sometimes") selected.push(`Outdoor activity: ${preferences.outdoorActivity.toLowerCase()}`);
  if (preferences.children) selected.push("Children in household");
  if (preferences.olderAdults) selected.push("Older adults in household");
  return selected.length ? selected.join(" · ") : "No optional preferences selected";
}

const GUIDANCE_LABELS: Record<Recommendation["guidanceType"], string> = {
  personalized: "Personalized advice",
  general: "General guidance",
  conditional: "Conditional suggestion"
};
const PREFERENCE_LABELS: Record<UserPreferenceKey, string> = {
  ageGroup: "age group",
  occupation: "occupation",
  commute: "commute type",
  outdoorActivity: "outdoor activity preference",
  children: "children in household",
  olderAdults: "older adults in household"
};
const BASIS_LABELS: Record<Recommendation["basis"][number], string> = {
  current_official_aqi: "Current official CPCB AQI",
  official_pollutant_observation: "CPCB pollutant observation",
  supplementary_measurement: "Separate OpenAQ measurement",
  selected_location: "Selected location",
  lifestyle_preferences: "Selected lifestyle preferences",
  general_guidance: "General guidance"
};

export default function Dashboard() {
  const [location, setLocation] = useState<LocationChoice>(EMPTY_LOCATION);
  const [air, setAir] = useState<AirQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationOpen, setLocationOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [notice, setNotice] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");

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

  useEffect(() => {
    const sections = ["overview", "recommendations", "assistant"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.2, 0.5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
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
  const hasOfficialAqi = official?.aqi !== null && official?.aqi !== undefined;
  const locationLabel = location.city || (location.latitude !== null ? "Current location" : "Choose an area");
  const recommendationItems = buildRecommendations(air, preferences);
  const indoorRecommendation = recommendationItems.find((item) => item.action === "Reduce indoor pollution and time ventilation");
  const eveningRecommendation = recommendationItems.find((item) => item.action.toLowerCase().includes("evening"));
  const actionPlan = indoorRecommendation
    ? recommendationItems.filter((item) => item !== indoorRecommendation && item !== eveningRecommendation)
    : recommendationItems.filter((item) => item !== eveningRecommendation);

  function askAssistant(prompt: string) {
    const assistant = document.getElementById("assistant");
    assistant?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    window.dispatchEvent(new CustomEvent("airwise:prompt", { detail: prompt }));
  }

  function navigationLink(id: string, label: string) {
    return <a
      href={`#${id}`}
      className={activeSection === id ? "active" : undefined}
      aria-current={activeSection === id ? "location" : undefined}
      onClick={() => setMobileMenuOpen(false)}
    >{label}</a>;
  }

  const refreshButton = (className = "refresh-button") => <button
    type="button"
    className={className}
    onClick={() => void refresh(location)}
    disabled={loading}
  >
    <RefreshCw size={17} className={loading ? "spin" : ""} />
    <span>{loading ? "Checking sources" : "Refresh data"}</span>
  </button>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a href="#top" className="brand" aria-label="AIRWISE INDIA home">
            <span className="brand-icon"><Wind size={21} strokeWidth={1.8} /></span>
            <span className="brand-copy"><strong>AIRWISE</strong><small>INDIA</small></span>
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            {navigationLink("overview", "Overview")}
            {navigationLink("recommendations", "Your plan")}
            {navigationLink("assistant", "Ask AIRWISE")}
          </nav>
          <div className="top-actions">
            <button type="button" className="location-button" onClick={() => setLocationOpen(true)}>
              <MapPin size={17} /><span>{locationLabel}</span><span className="chevron" aria-hidden="true">⌄</span>
            </button>
            <button type="button" className="profile-button" onClick={() => setPreferencesOpen(true)}><Users size={17} /> Personalize</button>
          </div>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >{mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>
        </div>
        <div className="mobile-menu" id="mobile-navigation" hidden={!mobileMenuOpen}>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navigationLink("overview", "Overview")}
            {navigationLink("recommendations", "Your plan")}
            {navigationLink("assistant", "Ask AIRWISE")}
          </nav>
          <div className="mobile-menu-actions">
            <button type="button" className="location-button" onClick={() => setLocationOpen(true)}>
              <MapPin size={17} /><span>{locationLabel}</span><span className="chevron" aria-hidden="true">⌄</span>
            </button>
            <button type="button" className="profile-button" onClick={() => setPreferencesOpen(true)}><Users size={17} /> Personalize</button>
            {refreshButton("refresh-button")}
          </div>
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="hero-section" id="overview" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">Air quality, with context</p>
            <h1 id="page-title">Make informed decisions about the air you breathe.</h1>
            <p>Understand local measurements, plan your day and find practical ways to reduce pollution exposure.</p>
          </div>
          <div className="hero-actions">
            <div className="hero-location">
              <span>Selected area</span>
              <strong><MapPin size={17} />{locationLabel}</strong>
              <small>{location.city ? "India" : location.latitude !== null ? "Using browser coordinates" : "Choose a city to check available sources"}</small>
            </div>
            {refreshButton()}
          </div>
        </section>

        <section className="dashboard-grid" aria-label="Air quality overview">
          <section className={`aqi-card ${hasOfficialAqi ? "aqi-card-verified" : "aqi-card-unavailable"}`} aria-labelledby="aqi-title">
            <div className="aqi-card-top">
              <div>
                <p className="card-kicker">Official CPCB air quality</p>
                <h2 id="aqi-title">{location.city || official?.city || "Your selected area"}</h2>
                <p>{official?.state ? `${official.state}, India` : location.city ? "India" : "Select a city or use your current location"}</p>
              </div>
              {loading
                ? <span className="status-pill status-unavailable" role="status"><i />Checking source</span>
                : <StatusPill status={hasOfficialAqi
                  ? official?.status ?? "unavailable"
                  : official?.status === "not_configured" ? "not_configured" : official?.status === "unverified" ? "unverified" : "unavailable"} />}
            </div>
            <div className="aqi-main-row">
              <div className="aqi-number-wrap" aria-label={hasOfficialAqi ? `Official India AQI ${official?.aqi}` : "Official AQI unavailable"}>
                <span className="aqi-number">{loading ? "…" : official?.aqi ?? "—"}</span>
                <span className="aqi-unit">India AQI</span>
              </div>
              <div className="aqi-summary">
                <h3 className={hasOfficialAqi ? "category-label" : "category-label muted"}>
                  {official?.category ?? (loading ? "Checking the official source" : official?.status === "unverified" ? "Reading needs verification" : "No verified index")}
                </h3>
                <p>{official?.interpretation ?? official?.message ?? "Checking the configured CPCB source. AIRWISE never estimates an AQI."}</p>
                <div className="aqi-meta">
                  {official?.station && <span className="station-line"><MapPin size={16} />{official.station}{official.city ? ` · ${official.city}` : ""}</span>}
                  {official?.distanceMeters !== null && official?.distanceMeters !== undefined && <span className="station-line"><MapPin size={16} />{new Intl.NumberFormat("en-IN").format(official.distanceMeters)} m from selected area</span>}
                  {official?.updatedAt && <span className="station-line"><Clock3 size={16} />Observed {timeLabel(official.updatedAt) ?? "time unavailable"} · {ageLabel(official.updatedAt)}</span>}
                </div>
                {official?.pagination && <details className="pagination-details">
                  <summary>Source collection details</summary>
                  <p role="status">CPCB pagination {official.pagination.status === "complete" ? "verified" : "unverified"}: {official.pagination.uniqueRecords}
                    {official.pagination.reportedTotal === null ? " records observed" : ` of ${official.pagination.reportedTotal} reported`}
                    {official.pagination.duplicateRows > 0 ? ` · ${official.pagination.duplicateRows} repeated rows` : ""}
                    {official.pagination.conflictingRows > 0 ? ` · ${official.pagination.conflictingRows} conflicting rows` : ""}
                    {` · ${official.pagination.pageCount} page requests`}</p>
                </details>}
                {!loading && !hasOfficialAqi && <div className="aqi-help-actions">
                  <button type="button" className="text-button" onClick={() => setLocationOpen(true)}>Choose another area <ArrowRight size={16} /></button>
                  <span>You can also refresh to check the source again.</span>
                </div>}
              </div>
            </div>
            <div className="aqi-card-footer">
              <div className="source-mark"><ShieldCheck size={19} /><div><strong>Source</strong><span>CPCB via data.gov.in</span></div></div>
              <a className="source-link" href="https://www.data.gov.in/catalog/real-time-air-quality-index" target="_blank" rel="noreferrer">About this source <ExternalLink size={15} /></a>
            </div>
          </section>

          <aside className="side-stack" aria-label="Personal air-quality context">
            <section className="insight-card">
              <p className="card-kicker">A useful way to read this</p>
              <h2>{hasOfficialAqi ? "One station is a local signal." : "No reading is still useful context."}</h2>
              <p>{hasOfficialAqi
                ? "Use the station reading as one input for your day. Conditions can differ across a city."
                : "Current CPCB AQI has not been verified for this area. Use general guidance until a source is available."}</p>
              <button type="button" className="text-button" onClick={() => askAssistant("How should I use the available air-quality information for my day?")}>Ask about your day <ArrowRight size={16} /></button>
            </section>
            <section className="profile-strip" aria-label="Saved preferences">
              <div className="profile-strip-copy">
                <strong>Your plan preferences</strong>
                <span>{selectedPreferencesLabel(preferences)}</span>
              </div>
              <button type="button" className="icon-button" aria-label="Edit personal preferences" onClick={() => setPreferencesOpen(true)}><ArrowRight size={18} /></button>
            </section>
          </aside>
        </section>

        <section className="section-block pollutant-section" aria-labelledby="pollutant-title">
          <div className="section-heading">
            <div><p className="eyebrow">Station detail</p><h2 id="pollutant-title">Pollutant observations</h2></div>
            <p className="section-caption">Raw CPCB readings · not an AQI</p>
          </div>
          <div className="pollutant-grid">
            {[
              ["PM2.5", "Fine particles", "mint"], ["PM10", "Coarse particles", "peach"],
              ["NO2", "Nitrogen dioxide", "blue"], ["O3", "Ozone", "lilac"],
              ["SO2", "Sulphur dioxide", "yellow"], ["CO", "Carbon monoxide", "rose"]
            ].map(([code, label, color]) => {
              const reading = readingFor(official?.pollutants ?? [], code);
              return <article className={`pollutant-card pollutant-${color}`} key={code}>
                <div className="pollutant-heading"><h3>{code}</h3><span>{label}</span></div>
                <strong className="pollutant-value">{valueLabel(reading)} <small>{reading?.unit ?? (reading ? "Unit not supplied" : "Not reported")}</small></strong>
                <p className="pollutant-time">{reading?.measuredAt
                  ? `${reading.freshness === "stale" ? "Stale observation" : reading.freshness === "unverified" ? "Unverified time" : "Observed"} · ${timeLabel(reading.measuredAt) ?? "time unavailable"}`
                  : "No observation available from CPCB"}</p>
              </article>;
            })}
          </div>
          <p className="data-note"><ShieldCheck size={17} />{official?.message ?? "Pollutant values appear only when returned by the selected CPCB source."}</p>
        </section>

        <section className="section-block plan-section" id="recommendations" aria-labelledby="recommendations-title">
          <div className="section-heading">
            <div><p className="eyebrow">Small steps for real routines</p><h2 id="recommendations-title">A plan that travels with you</h2>
              <p className="section-intro">Standard rule-based guidance, clearly separated from AI answers and current source readings.</p></div>
            <button type="button" className="outline-button" onClick={() => setPreferencesOpen(true)}>Tune your plan <ArrowRight size={16} /></button>
          </div>
          <RecommendationCards recommendations={actionPlan} onAsk={askAssistant} />
          <p className="recommendation-source"><ShieldCheck size={17} />Guidance stays general where no selected preference or verified current reading supports personalization.</p>
        </section>

        {indoorRecommendation && <section className="section-block indoor-coach" aria-labelledby="indoor-title">
          <div className="indoor-coach-intro">
            <p className="eyebrow">Workday and at home</p>
            <h2 id="indoor-title">Improve indoor air with practical routines.</h2>
            <p>{indoorRecommendation.reason}</p>
            <span className={`recommendation-guidance-type guidance-${indoorRecommendation.guidanceType}`}>{GUIDANCE_LABELS[indoorRecommendation.guidanceType]}</span>
            <p className="intended-profile"><strong>For</strong>{indoorRecommendation.intendedProfile}</p>
            {indoorRecommendation.personalizedBy.length > 0 && <p className="intended-profile"><strong>Based on selected</strong>{indoorRecommendation.personalizedBy.map((key) => PREFERENCE_LABELS[key]).join(", ")}</p>}
            {indoorRecommendation.conditionalOn.length > 0 && <p className="intended-profile"><strong>Only if applicable</strong>{indoorRecommendation.conditionalOn.map((key) => PREFERENCE_LABELS[key]).join(", ")}</p>}
          </div>
          <div className="indoor-coach-practice">
            <h3>Practical steps</h3>
            <ol>{indoorRecommendation.practicalSteps.map((step) => <li key={step}>{step}</li>)}</ol>
            <div className="indoor-benefit"><strong>Expected benefit</strong><p>{indoorRecommendation.expectedBenefit}</p></div>
            {indoorRecommendation.environmentalImpact && <p className="indoor-impact">{indoorRecommendation.environmentalImpact}</p>}
            <p className="indoor-basis"><strong>Basis:</strong> {indoorRecommendation.basis.map((basis) => BASIS_LABELS[basis]).join(" · ")}</p>
            <button type="button" className="text-button" onClick={() => askAssistant(`Explain this indoor-air suggestion for my situation: ${indoorRecommendation.action}`)}>Ask AIRWISE about this <ArrowRight size={16} /></button>
          </div>
        </section>}

        {eveningRecommendation && <section className="section-block evening-plan" aria-labelledby="evening-plan-title">
          <div className="section-heading">
            <div><p className="eyebrow">Evening</p><h2 id="evening-plan-title">Check conditions before evening plans.</h2></div>
          </div>
          <RecommendationCards recommendations={[eveningRecommendation]} startIndex={2} onAsk={askAssistant} />
        </section>}

        <section className="section-block supplementary-section" aria-labelledby="supplementary-title">
          <div className="section-heading compact-heading">
            <div><p className="eyebrow">Separate supplementary source</p><h2 id="supplementary-title">Nearby sensor measurements</h2>
              <p className="section-intro">OpenAQ readings are raw observations from their own stations and timestamps.</p></div>
            <StatusPill status={supplementary?.status ?? "not_configured"} />
          </div>
          <div className="supplementary-card">
            <div className="supplementary-intro">
              <strong>{supplementary?.station ?? "OpenAQ sensor network"}</strong>
              <p>{supplementary?.distanceMeters !== null && supplementary?.distanceMeters !== undefined
                ? `Nearest reference monitor · ${new Intl.NumberFormat("en-IN").format(supplementary.distanceMeters)} m from the selected area`
                : supplementary?.message ?? "Coordinates and an OpenAQ key are needed to search nearby."}</p>
            </div>
            {supplementary?.measurements.length ? <div className="supplementary-values">
              {supplementary.measurements.slice(0, 5).map((item, index) => <div className="supplementary-reading" key={`${item.parameter}-${index}`}>
                <span>{item.parameter}</span>
                <strong>{valueLabel(item)} <small>{item.unit ?? "Unit not supplied"}</small></strong>
                <small>{(item.freshness === "stale" ? "Stale historical · " : item.freshness === "unverified" ? "Unverified · " : "Observed · ") + (item.measuredAt ? timeLabel(item.measuredAt) + " · " + ageLabel(item.measuredAt) : "time unavailable · age unavailable")}</small>
              </div>)}
              <p className="supplementary-updated">Each sensor is reported at its own observation time.</p>
            </div> : <p className="supplementary-empty">No nearby measurement is available to show.</p>}
          </div>
          <p className="data-note"><Activity size={17} />OpenAQ values are supplementary sensor observations. They are not official CPCB AQI.</p>
        </section>

        <AssistantPanel location={location} preferences={preferences} />
        <footer className="page-footer">
          <a href="#top" className="footer-brand"><span className="brand-icon"><Wind size={17} /></span>AIRWISE INDIA</a>
          <p>Clear information. Practical choices.</p>
          <a href="https://www.data.gov.in/catalog/real-time-air-quality-index" target="_blank" rel="noreferrer">CPCB data source <ExternalLink size={14} /></a>
        </footer>
        {notice && <p className="floating-notice" role="status">{notice}</p>}
      </main>

      {locationOpen && <LocationDialog initial={location} onClose={() => setLocationOpen(false)} onApply={applyLocation} />}
      {preferencesOpen && <PreferencesDialog initial={preferences} onClose={() => setPreferencesOpen(false)} onSave={applyPreferences} />}
    </div>
  );
}
