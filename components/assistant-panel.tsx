"use client";

import { ArrowRight, Send, ShieldCheck, Sparkles, Wind } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LocationChoice } from "@/components/location-dialog";
import type { UserPreferences } from "@/types/preferences";
import type { AssistantAdvice } from "@/types/recommendation";

type Message = {
  role: "user" | "assistant";
  content: string;
  advice?: AssistantAdvice;
  verifiedData?: string;
  responseMode?: "ai_generated" | "standard_guidance";
  provider?: string;
  providerNote?: string;
  providerNotice?: string;
  limitationNotice?: string;
  aiUnavailable?: boolean;
};
type ProviderDiagnostic = {
  httpStatus?: number | null;
  providerCode?: string | null;
  providerMessage?: string | null;
  responseIssue?: string;
  diagnosticCategory?: string;
};

const PREFERENCE_LABELS: Record<string, string> = {
  ageGroup: "age group", occupation: "occupation", commute: "commute type",
  outdoorActivity: "outdoor activity", children: "children in household", olderAdults: "older adults in household"
};

const GUIDANCE_LABELS = {
  personalized: "Personalized advice",
  general: "General guidance",
  conditional: "Conditional suggestion"
} as const;

const STARTERS = [
  "Is a morning walk a good idea?",
  "How can I protect my family?",
  "What can I change about my commute?"
];

export default function AssistantPanel({ location, preferences }: {
  location: LocationChoice;
  preferences: UserPreferences;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      const prompt = (event as CustomEvent<unknown>).detail;
      if (typeof prompt === "string") setQuestion(prompt.slice(0, 1200));
    };
    window.addEventListener("airwise:prompt", onPrompt);
    return () => window.removeEventListener("airwise:prompt", onPrompt);
  }, []);

  async function submit(event?: FormEvent<HTMLFormElement>, suggested?: string) {
    event?.preventDefault();
    const text = (suggested ?? question).trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setQuestion("");
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: location.city,
          latitude: location.latitude ?? undefined,
          longitude: location.longitude ?? undefined,
          preferences,
          messages: next.slice(-8).map(({ role, content }) => ({ role, content }))
        })
      });
      const payload = await response.json() as {
        answer?: string;
        message?: string;
        advice?: AssistantAdvice;
        verifiedData?: string;
        responseMode?: "ai_generated" | "standard_guidance";
        provider?: string;
        providerNotice?: string;
        limitationNotice?: string;
        failedProvider?: string;
        diagnostics?: { cloudflare?: ProviderDiagnostic; gemini?: ProviderDiagnostic; openrouter?: ProviderDiagnostic; ollama?: ProviderDiagnostic };
        diagnostic?: ProviderDiagnostic;
      };
      const diagnostics = [
        { provider: "Cloudflare Workers AI", value: payload.diagnostics?.cloudflare },
        { provider: "Gemini", value: payload.diagnostics?.gemini },
        { provider: "OpenRouter", value: payload.diagnostics?.openrouter },
        { provider: "Ollama", value: payload.diagnostics?.ollama }
      ];
      const diagnosticEntry = diagnostics.find(({ value }) => value?.httpStatus || value?.providerMessage || value?.responseIssue)
        ?? diagnostics.find(({ value }) => value !== undefined);
      const diagnostic = diagnosticEntry?.value ?? payload.diagnostic;
      const providerNote = [
        ...(payload.diagnostics?.cloudflare?.httpStatus ? [`Cloudflare Workers AI HTTP ${payload.diagnostics.cloudflare.httpStatus}${payload.diagnostics.cloudflare.providerCode ? ` (${payload.diagnostics.cloudflare.providerCode})` : ""}`] : []),
        ...(payload.diagnostics?.gemini?.httpStatus ? [`Gemini HTTP ${payload.diagnostics.gemini.httpStatus}${payload.diagnostics.gemini.providerCode ? ` (${payload.diagnostics.gemini.providerCode})` : ""}`] : []),
        ...(payload.diagnostics?.openrouter?.httpStatus ? [`OpenRouter HTTP ${payload.diagnostics.openrouter.httpStatus}${payload.diagnostics.openrouter.providerCode ? ` (${payload.diagnostics.openrouter.providerCode})` : ""}`] : []),
        ...(payload.diagnostics?.ollama?.httpStatus ? [`Ollama HTTP ${payload.diagnostics.ollama.httpStatus}${payload.diagnostics.ollama.providerCode ? ` (${payload.diagnostics.ollama.providerCode})` : ""}`] : [])
      ].join(" · ");
      const diagnosticDetail = diagnostic?.providerMessage ?? (diagnostic?.responseIssue
        ? `AIRWISE response check: ${diagnostic.responseIssue}.`
        : "");
      const diagnosticText = diagnostic?.httpStatus
        ? ` ${diagnosticEntry?.provider ?? "Provider"} response: HTTP ${diagnostic.httpStatus}${diagnostic.providerCode ? ` (${diagnostic.providerCode})` : ""}.${diagnostic.diagnosticCategory ? ` Diagnostic: ${diagnostic.diagnosticCategory}.` : ""}${diagnosticDetail ? ` ${diagnosticDetail}` : ""}`
        : "";
      const answer = response.ok && payload.answer
        ? payload.answer
        : (payload.message ?? "The assistant isn't available right now. I can't verify a current AQI.") + diagnosticText;
      const standardFailureGuidance = !response.ok && payload.responseMode === "standard_guidance" && payload.provider === "AIRWISE rules";
      setMessages([...next, {
        role: "assistant",
        content: answer,
        advice: response.ok || standardFailureGuidance ? payload.advice : undefined,
        verifiedData: payload.verifiedData,
        responseMode: response.ok || standardFailureGuidance ? payload.responseMode : undefined,
        provider: response.ok || standardFailureGuidance ? payload.provider : undefined,
        providerNotice: payload.providerNotice,
        limitationNotice: payload.limitationNotice,
        providerNote: providerNote || undefined,
        aiUnavailable: !response.ok && payload.failedProvider === "Cloudflare Workers AI"
      }]);
    } catch {
      setMessages([...next, {
        role: "assistant",
        content: "I couldn't reach the assistant. I can't verify the current AQI, but you can still explore the general recommendations above."
      }]);
    } finally {
      setBusy(false);
    }
  }

  function setStarterQuestion(text: string) {
    setQuestion(text);
    document.getElementById("assistant-question")?.focus();
  }

  return <section className="assistant-section" id="assistant" aria-labelledby="assistant-title">
    <div className="assistant-intro">
      <span className="assistant-orb"><Sparkles size={22} /></span>
      <div>
        <p className="eyebrow">Ask AIRWISE</p>
        <h2 id="assistant-title">A thoughtful answer starts with context.</h2>
        <p>Ask about a journey, a routine or the readings available for your area. AIRWISE separates verified measurements from general suggestions.</p>
        <div className="assistant-trust"><ShieldCheck size={17} />Your selected preferences stay in this browser. Only the question and relevant selected context are sent to an AI provider when it returns validated advice.</div>
      </div>
    </div>
    <div className="chat-panel">
      <div className="chat-topline">
        <span className="assistant-avatar"><Wind size={17} /></span>
        <div><strong>AIRWISE India</strong><small>Local data when available · clear when it is missing</small></div>
        <span className="chat-status"><i /> Ready when you are</span>
      </div>
      <div className="chat-messages" role="log" aria-live="polite" aria-label="Assistant conversation" aria-busy={busy}>
        {messages.length === 0
          ? <div className="assistant-welcome"><span><Sparkles size={17} /></span><p>What would you like to plan? Try one of the questions below, or write your own. I’ll say when current data is unavailable.</p></div>
          : messages.map((message, index) => <div className={`chat-message message-${message.role}`} key={index}>
              {message.role === "assistant" && <span className="message-avatar"><Wind size={13} /></span>}
              <p>{message.content}</p>
              {message.aiUnavailable && <small className="assistant-failure-role" role="status">AI unavailable · Cloudflare Workers AI</small>}
              {message.responseMode && <small className="assistant-response-mode">
                {message.responseMode === "standard_guidance"
                  ? "Standard AIRWISE guidance · rule-based, not AI-generated"
                  : message.provider === "Cloudflare Workers AI"
                    ? "AI-generated recommendations · Cloudflare Workers AI"
                    : `AI-generated recommendations · ${message.provider ?? "configured provider"}`}
              </small>}
              {message.providerNote && <small className="assistant-provider-diagnostic">Provider status: {message.providerNote}</small>}
              {message.providerNotice && <small className="assistant-provider-diagnostic">{message.providerNotice}</small>}
              {message.limitationNotice && <small className="assistant-uncertainty">{message.limitationNotice}</small>}
              {message.verifiedData && <details className="verified-context"><summary>Verified source context</summary><pre>{message.verifiedData}</pre></details>}
              {message.advice?.recommendations.map((recommendation, itemIndex) => <article className="assistant-recommendation" key={itemIndex}>
                <small className={`assistant-guidance-type guidance-${recommendation.guidanceType}`}>{GUIDANCE_LABELS[recommendation.guidanceType]}</small>
                <strong>{recommendation.action}</strong>
                <p>{recommendation.reason}</p>
                <small>For: {recommendation.intendedProfile}</small>
                {recommendation.personalizedBy.length > 0 && <small>Supported by selected: {recommendation.personalizedBy.map((key) => PREFERENCE_LABELS[key]).join(", ")}</small>}
                {recommendation.conditionalOn.length > 0 && <small>Condition, if applicable: {recommendation.conditionalOn.map((key) => PREFERENCE_LABELS[key]).join(", ")}</small>}
                <small>Expected benefit: {recommendation.expectedBenefit}</small>
                <ul>{recommendation.practicalSteps.map((step) => <li key={step}>{step}</li>)}</ul>
                {recommendation.environmentalImpact && <small>{recommendation.environmentalImpact}</small>}
              </article>)}
              {message.advice?.uncertainty && <small className="assistant-uncertainty">{message.advice.uncertainty}</small>}
            </div>)}
        {busy && <div className="chat-message message-assistant"><span className="message-avatar"><Wind size={13} /></span><p className="typing">Checking available context…</p></div>}
      </div>
      <div className="suggested-prompts" aria-label="Suggested questions">
        {STARTERS.map((text) => <button type="button" key={text} onClick={() => setStarterQuestion(text)}>{text}<ArrowRight size={15} /></button>)}
      </div>
      <form className="chat-form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="assistant-question">Ask AIRWISE INDIA</label>
        <input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your daily routine…" maxLength={1200} aria-describedby="assistant-disclaimer" />
        <button type="submit" aria-label="Send question" disabled={!question.trim() || busy}><Send size={17} /></button>
      </form>
      <p className="chat-disclaimer" id="assistant-disclaimer">General information only; not medical advice. Current AQI is shown only when it is verified by the official source.</p>
    </div>
  </section>;
}
