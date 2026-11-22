"use client";

import { ArrowRight, Check, Leaf, ShieldCheck, Wind } from "lucide-react";
import { buildRecommendations } from "@/lib/recommendations/engine";
import type { AirQualityResponse } from "@/types/air-quality";
import type { UserPreferences } from "@/types/preferences";

const ICONS = [Wind, ShieldCheck, Leaf];
const TONES = ["rec-green", "rec-blue", "rec-peach"];
const BASIS_LABELS: Record<string, string> = {
  current_official_aqi: "Current official CPCB AQI",
  official_pollutant_observation: "CPCB pollutant observation",
  supplementary_measurement: "Separate OpenAQ measurement",
  selected_location: "Selected location",
  lifestyle_preferences: "Saved lifestyle preferences",
  general_guidance: "General guidance"
};
const PREFERENCE_LABELS: Record<string, string> = {
  ageGroup: "age group", occupation: "occupation", commute: "commute type",
  outdoorActivity: "outdoor activity preference", children: "children in household",
  olderAdults: "older adults in household"
};
const GUIDANCE_LABELS = {
  personalized: "Personalized advice",
  general: "General guidance",
  conditional: "Conditional suggestion"
} as const;

export default function RecommendationCards({
  preferences, air, onAsk
}: {
  preferences: UserPreferences;
  air: AirQualityResponse | null;
  onAsk: (question: string) => void;
}) {
  const items = buildRecommendations(air, preferences);
  return <div className="recommendation-grid">
    {items.map((item, index) => {
      const Icon = ICONS[index % ICONS.length];
      return <article className="recommendation-card" key={item.action}>
        <div className="recommendation-top">
          <span className={`rec-icon ${TONES[index % TONES.length]}`}><Icon size={18} /></span>
          <span className="rec-label">{index === 0 ? "DAILY ROUTINE" : index === 1 ? "AT HOME" : "LOWER EMISSIONS"}</span>
        </div>
        <small className={`recommendation-guidance-type guidance-${item.guidanceType}`}>{GUIDANCE_LABELS[item.guidanceType]}</small>
        <h3>{item.action}</h3>
        <p className="rec-why"><strong>Why it helps</strong>{item.reason}</p>
        <div className="rec-detail"><span>Intended for</span><strong>{item.intendedProfile}</strong></div>
        <div className="rec-detail"><span>Expected benefit</span><strong>{item.expectedBenefit}</strong></div>
        <div className="rec-detail"><span>Practical steps</span><strong>{item.practicalSteps.join(" ")}</strong></div>
        {item.personalizedBy.length > 0 && <div className="rec-detail"><span>Selected evidence</span><strong>{item.personalizedBy.map((key) => PREFERENCE_LABELS[key]).join(", ")}</strong></div>}
        {item.conditionalOn.length > 0 && <div className="rec-detail"><span>Condition, if applicable</span><strong>{item.conditionalOn.map((key) => PREFERENCE_LABELS[key]).join(", ")}</strong></div>}
        {item.environmentalImpact && <div className="rec-benefit"><Leaf size={15} /><span>{item.environmentalImpact}</span></div>}
        <p className="rec-basis"><Check size={14} />Basis: {item.basis.map((basis) => BASIS_LABELS[basis]).join(" · ")}</p>
        <button className="rec-action" onClick={() => onAsk("Explain this suggestion for my situation: " + item.action)}>
          Ask about this step<ArrowRight size={15} />
        </button>
      </article>;
    })}
  </div>;
}
