# AIRWISE INDIA

**Breathe smarter. Live better.**

AIRWISE INDIA is a responsive air-quality assistant foundation for residents across India. It combines an official CPCB/data.gov.in AQI source with optional nearby OpenAQ sensor measurements and a server-side AI adapter. The interface is designed to make missing or stale data visible instead of filling gaps with estimates.

## What is included

- Responsive Next.js App Router dashboard with a calm editorial visual system; see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for tokens, components, responsive rules, and accessibility decisions.
- Location selection by city name, browser geolocation, or manual coordinates.
- Optional local preferences for age group, routine, commute, outdoor activity, and household context. Preferences remain in the browser.
- CPCB/data.gov.in station matching by normalized city and, when supplied, station coordinates within 50 km. AQI is displayed only if an explicit same-station, same-timestamp AQI field is returned.
- Separate OpenAQ v3 location, sensor, and latest-measurement requests for one nearby reference monitor; each pollutant retains its own timestamp.
- Cloudflare Workers AI as the primary hosted inference provider, using the official OpenAI-compatible Chat Completions endpoint and JSON Mode.
- Gemini Interactions API with verified server context, lifestyle preferences, structured JSON response format, runtime validation, bounded retries, and a circuit breaker.
- OpenRouter chat-completions fallback with live model-catalogue compatibility checks and strict structured output.
- Optional loopback-only Ollama fallback for explicitly enabled non-production development; disabled by default. Deterministic AIRWISE rules remain the final fallback.
- Structured recommendations based on live official AQI only when verified, live CPCB pollutant observations, location, and saved profile preferences.
- Input validation, server-only credentials, timeouts, no-store responses, bounded request sizes, and basic per-instance rate limits.
- Logic tests for CPCB AQI category boundaries and safe CPCB response parsing.

The dashboard distinguishes verified CPCB AQI, raw CPCB pollutant observations, supplementary OpenAQ sensor measurements, standard recommendations, and validated AI answers. When an official AQI is missing, the interface says so and does not estimate one.

## Technology

- Next.js App Router, React, and strict TypeScript
- Tailwind CSS 4 and custom responsive CSS
- Lucide React
- Zod request validation
- Vitest
- CPCB / data.gov.in as the primary AQI source
- OpenAQ v3 as a supplementary raw measurement source
- Cloudflare Workers AI through its account-scoped OpenAI-compatible API
- Gemini Interactions API behind a replaceable server adapter
- OpenRouter chat completions as an independently configured fallback
- Vercel-compatible Node.js route handlers

Recharts and Supabase are intentionally not wired yet. No historical series or persistence layer is available in this first version, so adding either would imply functionality or data that is not present.

## Architecture

- `app/page.tsx` renders the dashboard client shell.
- `components/` contains the dashboard, location and preference dialogs, recommendations, and assistant panel.
- `app/api/aqi/route.ts` validates requests and returns current provider states.
- `app/api/assistant/route.ts` validates chat input, retrieves server-side readings, tries Cloudflare Workers AI, Gemini, OpenRouter, optional development-only Ollama, then deterministic rule-based guidance.
- `app/api/health/providers/route.ts` reports provider configuration and circuit state without making a provider request or returning credentials.
- `lib/aqi/cpcb.ts` calls the configured data.gov.in resource, matches station/city/location, and accepts only an explicit AQI at the selected observation timestamp.
- `lib/aqi/openaq.ts` locates one reference monitor within 25 km, fetches its sensor metadata, and reads its latest sensor values.
- `lib/aqi/categories.ts` maps an explicitly reported CPCB index to CPCB category bands. It does not calculate an index from measurements.
- `lib/recommendations/engine.ts` builds validated, profile-aware recommendations without inventing health or emissions numbers.
- `lib/ai/cloudflare.ts`, `lib/ai/gemini.ts`, and `lib/ai/openrouter.ts` send minimized verified context to hosted providers with bounded timeouts/retries and circuit protection; `lib/ai/ollama.ts` is a loopback-only, explicitly enabled development fallback. Every accepted response uses the same structured validation.
- `lib/ai/assistant.ts` selects the configured provider and falls back to deterministic, profile-aware standard guidance.
- `lib/validation/` and `lib/utils/rate-limit.ts` provide request checks and basic in-memory throttling.
- `types/` holds provider and preference contracts.

### Data states

- **Live**: a valid source timestamp is within three hours.
- **Stale**: the source timestamp is older than three hours.
- **Unavailable**: no matching response or a provider request failed.
- **Needs verification**: a response was malformed, missing a required field, or had an invalid timestamp/index.
- **Setup needed**: required server credentials are missing or rejected.

These labels are conservative client display rules. They do not change provider values.

## Install and run

Use Node.js 24.x (pinned in `package.json`; the local verification environment is Node 24.12.0).

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Environment configuration

Copy `.env.example` to `.env.local` and fill only the services you intend to enable.

- `DATA_GOV_API_KEY`: server-side API key generated through the OGD portal.
- `DATA_GOV_RESOURCE_ID` (optional): override for the CPCB real-time AQI resource UUID supplied for this project. The adapter uses that UUID by default.
- `OPENAQ_API_KEY`: server-side OpenAQ API key.
- `GEMINI_API_KEY`: server-side Gemini API key.
- `GEMINI_MODEL` (optional): model override. Default is `gemini-3.8-flash`.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_AI_MODEL`: server-only primary Cloudflare configuration. The adapter defaults the model to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, but production should set it explicitly.
- `OPENROUTER_API_KEY`: optional server-side OpenRouter fallback. Only configure it if this external fallback is intentionally enabled; a previously pasted key must be rotated before use.
- `OPENROUTER_MODEL` (optional): model ID verified against OpenRouter's current catalogue. `.env.example` uses the dynamic `openrouter/free` router, which selects an eligible free model; set a specific catalogue ID to override it.
- `OLLAMA_ENABLED=true`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL` (optional): enable local Ollama only for non-production development. It is disabled by default and cannot run when `NODE_ENV=production`.
- `NEXT_PUBLIC_APP_URL`: public app origin used as the canonical metadata base when set; it is a public URL, not a credential.

Never prefix provider credentials with `NEXT_PUBLIC_`. Do not commit `.env.local`.

### CPCB integration status

The adapter uses the official `https://api.data.gov.in/resource/{resource-id}` endpoint, the configured CPCB resource UUID, and the `api-key` query parameter. In a live authenticated Hyderabad probe, offsets 0 and 10 returned HTTP 200, `total=98`, and an effective page size of 10 even when a larger limit was requested. The record fields were `country`, `state`, `city`, `station`, `last_update`, `latitude`, `longitude`, `pollutant_id`, `min_value`, `max_value`, and `avg_value`; each sampled record value was a string. Pagination metadata included `total`, `count`, `limit`, and `offset`. There was no station ID, AQI field, unit, or averaging-period field in the sampled schema.

The adapter now fetches pages sequentially using the returned `limit` and `offset`, checks stable totals and record counts, detects duplicate rows, stops on rate limits, waits only for short `Retry-After` values, and caches complete city snapshots for five minutes. It does not make an unfiltered national scan for coordinate-only locations. On the 21 November 2026 five-city live check, Hyderabad, Delhi, Bengaluru, and Mumbai pagination encountered repeated rows and were returned as unverified with no selected station or AQI. Vijayawada returned a pollutant station observation but no explicit AQI field, so AQI remained unavailable. An earlier request returned HTTP 429. Pagination remains best effort because the live resource can change during offset-based reads.

The official AQI method requires at least three valid pollutants, including PM2.5 or PM10; at least 16 hours of data for a pollutant sub-index; 24-hour averages except 8-hour CO and O3; pollutant units and official breakpoints; breakpoint interpolation; and the highest valid sub-index as overall AQI. This resource supplies individual `avg_value` rows and timestamps, but not the unit, averaging window, or required hourly series. AIRWISE therefore does not calculate AQI from it. The [CPCB calculation guide](https://www.cpcb.nic.in/displaypdf.php?id=bmF0aW9uYWwtYWlyLXF1YWxpdHktaW5kZXgvSG93X0FRSV9DYWxjdWxhdGVkLnBkZg%3D%3D) describes those requirements. CPCB's [public AQI portal](https://airquality.cpcb.gov.in/AQI_India/) is available, but no documented direct AQI API was found; AIRWISE does not scrape undocumented endpoints.

### Third-party CPCB-derived AQI assessment

On 21 November 2026, a limited unauthenticated, city-only live request was made to the documented `api.dharun.dev` endpoint for Vijayawada, Hyderabad, Delhi, Bengaluru, and Mumbai. All five returned HTTP 200. The returned payloads named data.gov.in and its CPCB resource as the source and included station names, claimed AQI/category, an update time, and pollutant `min`/`max`/`avg` values. However, pollutant values did not include units or per-pollutant timestamps, and the response did not include the hourly concentration series or valid-hour counts needed to independently reproduce the claimed AQI. The provider's own note describes the pollutant values as CPCB sub-indices, which also prevents treating them as raw concentrations for an independent recalculation. One sample's station update time was about two hours behind the retrieval time.

The service documents request limits of 600/minute without a key and 3,000/minute with a key. Its privacy page describes request metadata logging, and its about page says the API code is AGPL-3.0 and the source data retains its stated license. No uptime SLA or independently verifiable provenance evidence was found. Because the AQI output could not be independently checked against source inputs and CPCB methodology, AIRWISE does **not** integrate or display this provider's AQI. The app continues to use the official data.gov.in adapter as its sole possible official AQI source, and it does not calculate an AQI from pollutant observations. See the provider's [API documentation](https://api.dharun.dev/docs/air-quality), [privacy policy](https://api.dharun.dev/privacy), [about and license information](https://api.dharun.dev/about), and [security page](https://api.dharun.dev/security).

### OpenAQ integration

OpenAQ v3 is queried only when coordinates and `OPENAQ_API_KEY` are supplied. It uses the `X-API-Key` header, searches for Indian reference monitors within 25 km, selects one nearest location, fetches that location's sensor metadata, then gets its latest values. Weather and other non-pollutant sensors are excluded. Each pollutant keeps its own unit, station, timestamp, and freshness. The dashboard shows the timestamp and age for each reading and marks stale readings as historical. It does not average different stations or times, and never presents OpenAQ data as CPCB AQI. A city name alone does not trigger geocoding.

Live probe on 21 November 2026: Hyderabad returned live OpenAQ values from New Malakpet, Hyderabad - TSPCB, including PM2.5 26.55 µg/m³ and PM10 58.68 µg/m³ at `2026-11-21T00:30:00Z`. Mumbai returned live PM2.5 117 µg/m³ at `2026-11-21T01:30:00Z`. Vijayawada's PWD Grounds records were stale (latest PM10/PM2.5 `2020-11-20T08:15:00Z`); Delhi's Mandir Marg data were stale (`2018-02-21T21:15:00Z`); Bengaluru's City Railway Station data were stale (`2018-02-22T03:00:00Z`). These remain historical OpenAQ readings, not current conditions or official AQI. Each displayed measurement has its own timestamp and freshness state.

### AI integration

The assistant sends minimized location context, verified CPCB/OpenAQ measurements, timestamps, recent conversation, and explicitly selected lifestyle preferences from the server route. Cloudflare Workers AI is primary and receives the AIRWISE JSON Schema through OpenAI-compatible JSON Mode; its output is still parsed and checked against the shared Zod, provenance, and safety validation because JSON Mode does not guarantee schema compliance. Gemini and OpenRouter are hosted fallbacks. Ollama is disabled by default and is available only when explicitly enabled outside production. Provider credentials and authorization headers are never returned or logged. Bounded timeouts, limited retries, safe diagnostics, and circuit breakers protect hosted calls; a rate-limited Cloudflare request is not retried before its stated `Retry-After`. If all hosted providers fail validation or are unavailable, deterministic recommendations are returned and labeled **Standard guidance, not AI-generated advice**. `/api/health/providers` exposes configuration and circuit state without contacting providers or returning credentials. Current-condition questions receive deterministic uncertainty guidance if live official AQI is unavailable. Conversation history remains in browser memory. See Cloudflare's [OpenAI-compatible endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/), and [model page](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/), plus the [Gemini quick start](https://ai.google.dev/gemini-api/docs/get-started) and [OpenRouter structured-output guide](https://openrouter.ai/docs/guides/features/structured-outputs).

Live Gemini diagnosis on 21 November 2026: Tests A (minimal text), B (minimal JSON schema), and C (AIRWISE assistant route) each received HTTP 503 `service_unavailable` for `gemini-3.8-flash`. No live assistant response passed AIRWISE validation, so Gemini is not operational in this check. The assistant route returns safe provider status and validation diagnostics instead of hiding upstream failures behind a generic 502.

## API routes

- `GET /api/aqi?city=Pune&latitude=18.5204&longitude=73.8567`
  - City is required to query CPCB/data.gov.in; coordinates alone are not used for a national scan.
  - Coordinates optionally narrow CPCB station matching and enable nearby OpenAQ measurements.
  - Latitude and longitude must be supplied together.
  - Returns official and supplementary source states separately.
- `POST /api/assistant`
  - Body includes a bounded list of user/assistant messages and optional location.
  - Reading data is fetched by the server; client-provided AQI context is not accepted.
- `GET /api/health/providers`
  - Reports provider configuration and circuit state only; it does not call external providers or expose credentials.

## Testing and checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` covers deterministic mocked provider responses. Run `npm run test:e2e` for Chromium tests at 390×844, 768×1024, and 1440×900, including WCAG 2.2 AA axe scans. On resource-constrained machines, `npm run test:e2e -- --workers=1` runs the same suite serially. Run `AIRWISE_LIVE_TESTS=1 npm run test:live` only when you intend to contact configured services; live checks never print API keys. Browser tests use the offline server guard and deterministic fixtures; they do not depend on external APIs.

## Engineering evidence

- [Code quality review](./CODE_QUALITY.md)
- [Security audit and deployment limits](./SECURITY_AUDIT.md)
- [Testing report](./TESTING.md)
- [Accessibility review](./ACCESSIBILITY.md)
- [PromptWars Challenge 6 traceability matrix](./PROBLEM_ALIGNMENT.md)
- [Repository findings and corrections](./AUDIT_FINDINGS.md)

## Deployment

The private GitHub repository is [surya066-git/airwise-india](https://github.com/surya066-git/airwise-india), with `main` as its default branch. The public production alias is [airwise-india-one.vercel.app](https://airwise-india-one.vercel.app/). Follow [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for production verification. `/api/aqi` and `/api/assistant` are pinned to Vercel's Mumbai region (`bom1`) because both call India-specific CPCB/data.gov.in data.

## Current limitations

- The original user-provided API keys were exposed in chat and one failed browser diagnostic log. The user later confirmed that all three keys were rotated and `.env.local` was updated. Their values are not reproduced in project documentation.
- CPCB pagination can overlap while the source changes and can return HTTP 429. AIRWISE fails closed on these incomplete snapshots and has no official AQI field to display.
- CPCB pollutant values do not include units or averaging windows, so the published AQI method cannot be reproduced from this resource.
- Gemini has not produced a response that passes application validation. Prompt 5's live A/B/C checks returned HTTP 503; the latest minimal-text request timed out, and Gemini returned HTTP 429 in the default OpenRouter full-route check.
- Prompt 14's response failed AIRWISE semantic validation with `unsupported_personalization`; its text was not retained, so the exact claim is unknown. Prompt 16 then made one Cloudflare-only assistant request through the UI with the selected Hyderabad public-transit preference. Cloudflare and AIRWISE both returned HTTP 200, structured and semantic validation passed, and the frontend showed the actual personalized recommendation with Cloudflare attribution and the AQI limitation notice. CPCB/OpenAQ were not queried; no other provider or retry was used. This verifies one live dev-mode result, not production deployment behavior.
- Recent live production AQI requests reached the function in Mumbai (`bom1`); data.gov.in returned a pagination overlap in one check and an upstream rate limit in the latest check. AIRWISE correctly withheld an AQI in both cases. The live homepage still exposes `http://localhost:3000` as its canonical URL; the layout fix prefers Vercel's production domain when a local URL is configured, but has not been deployed yet. See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for runtime details.
- The optional Ollama adapter is disabled by default and unavailable in production. Its development-only mock tests do not require a local model.
- Earlier OpenRouter attempts did not produce an accepted answer and the OpenRouter key was pasted in chat. Rotate/revoke it before enabling the OpenRouter production fallback if that has not already been done. Prompt 16's validated live response used Cloudflare.
- City-name matching uses exact case-insensitive matching against the returned `city` value; there is no geocoding or alias directory.
- OpenAQ nearby search needs coordinates. Its raw measurements do not form an official Indian AQI.
- The in-memory rate limiter is per Node.js process and is not a shared limit across Vercel instances. Configure platform-level rate limiting or a shared store before exposing the AI route to substantial public traffic.
- Preferences are stored in localStorage. There is no account, Supabase persistence, or cross-device sync.
- The app provides general pollution-reduction guidance, not medical advice.
- There is no historical data chart because no verified historical series has been configured.

### Prompt iteration 13 — Cloudflare validation and failure UX

- The previous Prompt 12 live attempt made exactly one assistant request, returned AIRWISE HTTP 502, and failed structured validation. Its captured report did not retain the Cloudflare HTTP status or exact validation issue; no AQI provider was queried, and no successful AI answer was displayed.
- Code inspection confirmed `lib/ai/cloudflare.ts` already sends `response_format: { type: "json_schema", json_schema: <AIRWISE schema> }` with the schema directly inside `json_schema`. This matches [Cloudflare JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/); no `name`, `strict`, or nested `schema` wrapper was present. The suspected request-format mismatch is therefore **not confirmed** as the live failure cause.
- The adapter now distinguishes upstream HTTP errors, invalid response envelopes, empty content, JSON parse failures, schema/safety validation failures, and accepted AI responses. Schema diagnostics contain sanitized field paths, expected/actual data types, and missing field names only; model text, prompts, and credentials are not retained. Refusal and incomplete responses fail closed.
- If the development-only Cloudflare verification route fails, the API preserves the upstream status separately from AIRWISE's route status and returns deterministic recommendations with an explicit Standard AIRWISE guidance label and source limitation. The assistant panel shows AI-unavailable state, standard guidance, and the data limitation, without success attribution.
- Playwright's dedicated development server enables a server-side offline guard and cannot reuse another server process. The guard prevents all AI and AQI provider requests; browser tests mock the application endpoints. No live APIs were called for Prompt 13.
- Verification passed: `npm run typecheck`, `npm run lint`, `npm test` (17 files, 149 tests), `npm run build`, and `npm run test:e2e -- --workers=1` (36 tests across mobile, tablet, and desktop).
- Live Cloudflare verification remains required. Offline mocks and browser rendering tests demonstrate failure handling only, not successful inference.

### Prompt iteration 15 — explicit personalization evidence

- Prompt 14 produced a non-empty Cloudflare HTTP 200 response that parsed as JSON and passed structural validation, but AIRWISE rejected it as `unsupported_personalization` and returned HTTP 502. The actual generated text was not retained; the specific unsupported claim cannot be determined. No data-provider request was made as part of that attempt.
- AI personalization now uses only explicit structured preferences. Supported keys and values are `ageGroup` (`Prefer not to say`, `Under 18`, `18-59`, `60+`), `occupation` (`Resident`, `Student`, `Office worker`, `Outdoor worker`), `commute` (`Not applicable`, `Walk or cycle`, `Public transit`, `Two-wheeler`, `Car`, `Mixed`), `outdoorActivity` (`Rarely`, `Sometimes`, `Most days`), and the explicitly supplied booleans `children` and `olderAdults`. Default preferences are not treated as user-selected evidence.
- Each AI recommendation now states whether it is `personalized`, `general`, or `conditional`. `personalizedBy` must cite only selected, schema-valid preference keys; `conditionalOn` must cite only unconfirmed preference keys and use matching conditional wording. Direct profile claims must match the selected value: a selected car commute cannot support a claim that the user takes a bus, and a commute mode alone does not establish daily frequency. Unsupported profile claims, unselected household claims, sensitive medical claims, and unsupported environmental claims remain rejected. Free-text labels such as “Daily commuter” do not count as structured profile evidence; the current app can support a transit-specific claim when `commute: Public transit` was explicitly selected.
- The shared provider prompt and Cloudflare instructions now exclude free-text profile labels as evidence, forbid invented or inferred preferences, ask for conditional wording when circumstances are unknown, and preserve environmental provenance. The AI output schema carries both classification and evidence keys. Safe general guidance remains available; an invalid AI answer is not silently rewritten as personalized or general output, and the existing deterministic fallback remains explicitly labeled **Standard guidance**.
- The UI labels each assistant recommendation as personalized advice, general guidance, or a conditional suggestion, displays cited/unconfirmed preference fields, and preserves Cloudflare attribution only for accepted AI output. Existing failure and environmental-data limitation notices remain in place.
- Offline test coverage includes selected commute evidence, conflicting commute modes, unsupported commute frequency, default-as-evidence rejection, unselected household claims, medical claims, general guidance with no profile, conditional household advice, missing profile, invalid key/value, multiple supported preferences, and no-evidence general guidance. No live AI or environmental-provider API request was made for Prompt 15.
- Verification passed: `npm run typecheck`, `npm run lint`, `npm test` (17 files, 154 tests), `npm run build`, and `npm run test:e2e -- --workers=1` (39 tests across mobile, tablet, and desktop). Automated provider/model responses were mocked. A genuine, validated Cloudflare recommendation remains unverified.

### Prompt iteration 16 — first validated personalized Cloudflare response

- Next.js environment loading confirmed all three Cloudflare variables were configured without displaying values. The existing model was `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; `.env.local` was not modified.
- The user authorized exactly one generation through the existing assistant UI, with Cloudflare only and no CPCB/OpenAQ/Gemini/OpenRouter/Ollama calls. The existing development-only `AIRWISE_LIVE_TEST_PROVIDER=cloudflare` path supplied an unavailable/unverified source state and AQI limitation notice, skipped data providers, and called the Cloudflare adapter with `maxRetries: 0`.
- In a fresh isolated browser context, the QA profile was created through the UI: Hyderabad, `commute: Public transit`, and all other preferences left at application defaults. The observed assistant POST contained that city, selected commute value, unselected defaults, and the requested question. Exactly one assistant POST was observed.
- Cloudflare returned HTTP 200; the assistant API route returned HTTP 200. Response JSON parsed, Cloudflare diagnostics reported `accepted_ai_response` / validation passed, and the response included a personalized recommendation citing `commute` plus a general recommendation. The response contained two recommendations; no conditional recommendation was returned in this live result.
- The browser displayed the actual returned recommendations, `AI-generated recommendations · Cloudflare Workers AI`, the Personalized advice and General guidance labels, and the notice that current AQI was unverified. No full model output or credentials were retained in diagnostics or documentation.
- This is one successful live development verification. The CPCB and OpenAQ source state remained unavailable because those providers were not queried. The existing Prompt 15 offline suite remains separate evidence and was not used to claim the live success.

## Prompt iteration 5 status (21 November 2026)

- CPCB offset pagination now records request/page metadata, detects duplicate identities and conflicting duplicate values, and returns incomplete or unverified states rather than claiming a complete dataset. A shared request queue and bounded rate-limit handling reduce concurrent pressure; only complete snapshots are cached. Live source pagination remains unstable, and no AQI field was present in the previously inspected records.
- The third-party API assessment found five HTTP 200 city responses but insufficient source inputs to independently validate its claimed AQI. It was not integrated and its values are not shown as official or trusted AQI.
- Gemini now has bounded jittered retry, timeout, safe diagnostics, circuit-breaker cooldown and recovery probe. Deterministic rules remain available when Gemini and optional Ollama are unavailable or return invalid output. The separate provider health route does not contact external services.
- Recommendations now identify preference fields used, preserve separate CPCB/OpenAQ source and timestamp for raw pollutant evidence, and keep standard guidance distinct from AI-generated responses.
- The user confirmed all three previously exposed API keys were rotated and that `.env.local` was updated. This iteration did not manually inspect or modify `.env.local`; Next.js loaded it during the production build without displaying values. `.gitignore` includes `.env*`. The workspace has no Git metadata, so whether `.env.local` is tracked cannot be verified here.
- Current local verification results are recorded in the Prompt 5 section of `PROMPT_FLOW.md`. Live OpenAQ and Gemini were not re-probed in this iteration to avoid repeated provider calls after the earlier five-city results and repeated Gemini HTTP 503 responses. Ollama remains unconfigured and mocked in tests.

## Prompt iteration 6 status (21 November 2026)

- The official CPCB National AQI page exposes a human-facing city/station/date-time view and a link labelled “AQI Data Repository.” CPCB material describes pollutant sub-indices and public CAAQMS information through its CCR portal. However, the portal did not return usable page content in this inspection (the indexed page showed network error/CAPTCHA text), and I found no documented public API, live feed, export schema, or supported machine endpoint. A repository link alone does not establish a supported programmatic interface. AIRWISE therefore keeps its existing data.gov.in adapter and fail-closed AQI behavior; no hidden portal endpoint or CAPTCHA-protected access was used. The portal view is evidence that official station/date-time AQI presentation exists, not evidence of a verified live API response. See the [CPCB AQI portal](https://airquality.cpcb.gov.in/AQI_India/), [CPCB annual report](https://cpcb.nic.in/openpdffile.php?id=UmVwb3J0RmlsZXMvMTczM18xNzQ0MDg4NjgzX21lZGlhcGhvdG8yMDM0Ny5wZGY%3D), and [CPCB AQI calculation guide](https://www.airquality.cpcb.gov.in/ccr_docs/How_AQI_Calculated.pdf).
- OpenRouter integration is server-side and uses the official chat-completions endpoint. Before calling the configured model, the adapter reads the public model catalogue and requires a chat-completions endpoint plus `structured_outputs`; the request also sets strict JSON Schema and requires parameter-compatible routing. `openrouter/free` is the current configurable example/default and the catalogue presently reports zero input/output prices. The router chooses its eligible model dynamically; rate limits and capacity vary. See the [live model catalogue](https://openrouter.ai/api/v1/models), [chat API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), and [free router details](https://openrouter.ai/openrouter/free).
- Routing is Gemini, then OpenRouter, then explicitly configured local Ollama, then deterministic AIRWISE rules. The UI distinguishes each AI provider from standard guidance. The shared prompt now excludes exact coordinates and default preference values while retaining the selected location label, verified measurements, timestamps, station/source context, and explicitly selected profile fields.
- The user supplied an OpenRouter key, which was added to `.env.local` without printing it. `OPENROUTER_MODEL` remains unset and defaults to `openrouter/free`. Test A (minimal text) returned HTTP 200 with text. Test B returned HTTP 200 but no usable structured content, so AIRWISE rejected the response. Test C returned HTTP 200 with **standard AIRWISE guidance**, not an AI-generated answer; Gemini returned HTTP 429 and OpenRouter returned HTTP 200 without usable structured output.
- A second structured/full-route attempt used the current catalogue-listed `baidu/ernie-5.5-flash-preview:free` (catalogue: zero input/output price, chat and structured-output support). The structured request returned HTTP 429 and the full route remained standard guidance. This model override was not saved. No live structured recommendation passed AIRWISE validation. The latest prior five-city check showed fresh OpenAQ observations for Hyderabad and Mumbai and stale readings for Vijayawada, Delhi, and Bengaluru; no new CPCB pagination or OpenAQ city sweep was run here.
- The OpenRouter credential was supplied in chat; rotate it before production use. No successful live Gemini generation is claimed; a minimal Gemini request timed out.
- Local results and human/AI contribution notes are in the Prompt 6 section of `PROMPT_FLOW.md`. Model calls in automated tests are mocked; the optional OpenRouter live suite requires `AIRWISE_LIVE_TESTS=1` and `OPENROUTER_API_KEY`.

## Prompt 4 final verification (21 November 2026)

- `npm run typecheck`: passed.
- `npm run lint`: passed with no findings.
- `npm test`: passed, 11 files and 81 tests; external providers were mocked.
- `npm run build`: passed; Next.js produced `/`, `/api/aqi`, and `/api/assistant`.
- `npm run test:e2e`: passed, 30 tests across mobile (390×844), tablet (768×1024), and desktop (1440×900).
- Live five-city CPCB/OpenAQ smoke test: passed as a route/schema smoke check. CPCB did not provide a verifiable AQI. OpenAQ supplied live readings for Hyderabad and Mumbai and stale readings for Vijayawada, Delhi, and Bengaluru; see the OpenAQ section above.
- Live Gemini tests A/B/C contacted Gemini and all received HTTP 503 `service_unavailable`; no AI advice was accepted by the app.
- `.env.local` exists and its configured variable names are populated. Provider credentials stay server-side and `.env*` is ignored. The keys were exposed in this conversation and one failed test diagnostic; rotate them before continued use.


## Prompt iteration 8 — OpenRouter response diagnosis and safe output-mode fallback

### Human decisions and constraints

- The user asked for diagnosis of successful-HTTP responses that did not contain usable AIRWISE advice, a controlled output-mode fallback, a safe Hyderabad commuter test context, provider attribution, and updated documentation.
- The user required that rate-limit responses stop further live calls, raw prompts/provider bodies remain private, reasoning never be surfaced as an answer, and existing AIRWISE schema/provenance checks remain enforced.
- The prior OpenRouter key remains configured in `.env.local`; its value is not recorded. The key was supplied in chat and should be rotated before production use.

### AI-generated implementation

- OpenRouter responses are now checked for top-level `error` and `choices[0].error` before content parsing. The adapter inspects finish reason, response model/provider, content type and length, refusal, tool-call count, and whether reasoning is present and its length. It never uses reasoning content as an answer and does not log raw response bodies, user prompts, or private data.
- Only an explicit unsupported `response_format`/JSON Schema error triggers a bounded output-mode fallback: strict JSON Schema when catalogued, JSON mode when `response_format` is supported, then a plain JSON instruction. Each candidate must parse as JSON and pass the existing Zod, provenance, and safety validation before the result is marked AI-generated. Empty content, refusal, tool calls, truncation, schema failures, and rate limits fail closed.
- HTTP 429 is no longer retried by the OpenRouter adapter. Diagnostics retain a bounded `Retry-After` value when supplied. Successful adapter metadata, including the output mode and validation outcome, is returned through the assistant route; the provider label remains OpenRouter only for validated output.
- The opt-in live suite now defines ordered checks A–E: minimal text; minimal JSON Schema; JSON mode; full AIRWISE schema; and the full Hyderabad assistant route using readings fetched by the application and an office-worker/public-transit profile. It logs only safe metadata and skips later requests after a 429.

### Live evidence and limitations

- No new live calls were made for Prompt 8 after the prior free-model request returned HTTP 429, as required by the rate-limit stop rule.
- The last basic `openrouter/free` request returned HTTP 200 with text. A prior full AIRWISE-schema request returned HTTP 200 but no usable text content, so AIRWISE rejected it. The earlier full assistant route returned HTTP 200 with standard rule-based guidance; its safe diagnostics showed Gemini HTTP 429 and OpenRouter HTTP 200 without usable structured output.
- A catalogue-listed free-model comparison returned HTTP 429. The raw response body from the prior HTTP 200 empty-output attempt was not retained, so its embedded error, finish reason, actual model/provider, refusal, and tool-call details cannot be reconstructed. The new parser records these safe fields on a future response.
- Prompt 8’s new minimal-schema and JSON-mode live checks, plus its data-backed full-route check, were not run after the rate-limit response. There is still no real OpenRouter recommendation that passed AIRWISE validation, and the final success criterion is not met.
- OpenRouter documents Chat Completions JSON Schema under `response_format` and notes that support is endpoint-specific. See its [structured-output guide](https://openrouter.ai/docs/guides/features/structured-outputs), [chat-completions API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), and [model catalogue](https://openrouter.ai/api/v1/models).

### Final local verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 16 files and 119 tests; external providers were mocked.
- `npm run test:e2e -- --workers=1`: passed, 33 tests across mobile, tablet, and desktop.
- `npm run build`: passed with `/`, `/api/aqi`, `/api/assistant`, and `/api/health/providers`.
- Local checks verify the implementation and UI; they do not demonstrate a successful live GenAI recommendation.

## Prompt iteration 10 — OpenRouter 429 root-cause diagnosis

### Human decisions and constraints

- The user asked for a diagnosis using retained evidence, one optional non-generation quota check, safer rate-limit diagnostics, regression tests, and a prepared but unexecuted retry. No model generation request was permitted during this iteration.

### Evidence and diagnosis

- The previous probe retained only HTTP 429 and code `429`; its harness did not save `error.message`, `error.metadata`, response headers, or a raw response. No separate request log containing those fields was found. The response model, upstream provider, and finish reason were not available.
- A fresh authenticated `GET /api/v1/key` returned HTTP 200. The key was accepted; the reported free-model daily counter was 7 used, 43 remaining, limit 50. This rules out an exhausted daily free-model counter at the time of the check, but says nothing about a per-minute limit or provider capacity. OpenRouter documents `limit_source` and reset-header interpretation in its [rate-limit diagnosis guide](https://openrouter.ai/blog/tutorials/llm-api-rate-limits/).
- The exact 429 source is **unknown**. Without the missing body metadata and headers, the evidence cannot distinguish a per-minute free-model limit, burst protection, or an upstream provider limit/capacity issue. No reset time can be recovered.

### AI-generated implementation

- The OpenRouter adapter now retains safe `limit_source`, provider name/code, limit and remaining counts, `Retry-After`, `X-RateLimit-Reset`, and the combined retry time. It reads allowlisted values from response headers or the OpenRouter error metadata headers and never returns raw provider error text.
- Known daily, per-minute, burst-protection, upstream rate-limit, and upstream-capacity sources receive separate classifications and user-facing messages. Unrecognized or missing sources remain `unknown`; the adapter does not rotate models automatically.
- A 429 opens the OpenRouter circuit immediately and blocks new requests until the later of the provider’s `Retry-After` and reset time; when neither is provided, it pauses for 60 seconds and allows a later user-triggered half-open probe. The request helper does not retry 429s.
- AIRWISE exposes the safe classified rate-limit notice beside standard guidance, preserving the explicit rule-based label.

### Controlled retry plan (not executed)

- Keep `google/gemma-4-26b-a4b-it:free`; do not rotate models while the prior source is unknown.
- The daily counter is available, but the prior per-minute/upstream reset was not captured. Do not treat the 43 remaining daily requests as evidence that a retry window has reset. Check provider status and wait for a known reset before one manually initiated attempt.
- Use `response_format: { type: "json_object" }`, no JSON Schema enforcement, and at most 120 output tokens. Require HTTP 200, no root/choice error, a normal finish reason, and JSON passing the dedicated strict three-field schema. Stop after one 429 or one validation failure.
- Only a later successful direct probe would permit considering a separate full AIRWISE route request; none was made here.

### Final verification

- The optional non-generation quota check returned HTTP 200, active/authenticated, 7 used, 43 remaining, limit 50. No generation endpoint was called during Prompt 10.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 16 files and 126 tests; provider calls were mocked.
- `npm run build`: passed with `/`, `/api/aqi`, `/api/assistant`, and `/api/health/providers`.
- `npm run test:e2e -- --workers=1`: passed, 33 tests across mobile, tablet, and desktop. The browser suite verifies the safe rate-limit notice and fallback attribution using mocked responses.
- The exact 429 cause and retry time remain unknown; a live AI recommendation has not been validated.
