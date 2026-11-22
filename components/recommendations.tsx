"use client";

import { ArrowRight } from "lucide-react";
import type { Recommendation } from "@/types/recommendation";

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
  recommendations, onAsk, startIndex = 0
}: {
  recommendations: Recommendation[];
  onAsk: (question: string) => void;
  startIndex?: number;
}) {
  return <div className="recommendation-grid">
    {recommendations.map((item, index) => {
      const context = item.action.toLowerCase().includes("evening")
        ? "Evening · activity planning"
        : item.action.toLowerCase().includes("outdoor")
          ? "Morning · outdoor plans"
          : "Commute · lower emissions";
      return <article className="recommendation-card" key={item.action}>
        <header className="recommendation-top">
          <span className="rec-step" aria-hidden="true">{String(startIndex + index + 1).padStart(2, "0")}</span>
          <div className="rec-context"><span className="rec-label">{context}</span>
            <small className={`recommendation-guidance-type guidance-${item.guidanceType}`}>{GUIDANCE_LABELS[item.guidanceType]}</small>
          </div>
        </header>
        <h3>{item.action}</h3>
        <div className="rec-why"><strong>Why it may help</strong><p>{item.reason}</p></div>
        <div className="rec-profile"><strong>Relevant for</strong><p>{item.intendedProfile}</p>
          {item.personalizedBy.length > 0 && <small>Based on selected: {item.personalizedBy.map((key) => PREFERENCE_LABELS[key]).join(", ")}</small>}
          {item.conditionalOn.length > 0 && <small>Only if relevant: {item.conditionalOn.map((key) => PREFERENCE_LABELS[key]).join(", ")}</small>}
        </div>
        <div className="rec-benefit"><strong>Expected benefit</strong><p>{item.expectedBenefit}</p></div>
        <div className="rec-steps"><strong>Practical steps</strong><ol>{item.practicalSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>
        {item.environmentalImpact && <p className="rec-impact">{item.environmentalImpact}</p>}
        <details className="rec-basis">
          <summary>What informs this suggestion</summary>
          <p>{item.basis.map((basis) => BASIS_LABELS[basis]).join(" · ")}</p>
        </details>
        <button type="button" className="rec-action" onClick={() => onAsk("Explain this suggestion for my situation: " + item.action)}>
          Ask AIRWISE about this<ArrowRight size={16} />
        </button>
      </article>;
    })}
  </div>;
}
