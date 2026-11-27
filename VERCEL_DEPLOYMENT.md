# AIRWISE INDIA — Vercel Deployment and Production Test Guide

## Status

### Latest application-code deployment — 27 November 2026

Commit `ba7b141` was pushed to `main`, and GitHub's Vercel status reported **Deployment has completed**. The production alias [airwise-india-one.vercel.app](https://airwise-india-one.vercel.app/) returned HTTP 200 with the expected canonical origin. `GET /api/health/providers` returned HTTP 200 and reported four provider entries; no credential-named fields were present. These read-only checks verified the deployment and safe health projection without calling CPCB, OpenAQ, or an AI provider. The Vercel CLI and dashboard credentials remain unavailable, so project settings and detailed function logs were not inspected.

Historical check on 25 November 2026: the public alias responded over HTTPS. `GET /` and `GET /api/health/providers` returned HTTP 200. In headless Chromium, the dashboard became interactive, accepted Hyderabad in the location dialog, and displayed the unverified AQI response without JavaScript errors. The homepage HTML had an incorrect canonical URL of `http://localhost:3000`; `app/layout.tsx` now uses Vercel's project production domain when `NEXT_PUBLIC_APP_URL` is a local address. That fix was subsequently confirmed in production.

`GET /api/aqi?city=Hyderabad` returned HTTP 200 and its Vercel request ID showed `bom1::bom1`, confirming the CPCB function ran in Mumbai and connected to data.gov.in. The source reported 98 matching records but an effective page size of 10; pages at offsets 0 and 10 contained a repeated station/pollutant/time identity. AIRWISE returned `official.status: unverified`, `aqi: null`, and no station rather than treating the incomplete snapshot as official. This is now an upstream data consistency/coverage issue, not the earlier connection failure. The response did not include coordinates, so OpenAQ was unavailable for that request.

The provider-health route reported Cloudflare, Gemini, and OpenRouter as configured, with Ollama unavailable. This endpoint only reports configuration and in-process circuit state; it does not prove that providers can generate responses. No production AI generation was sent. Vercel project settings and detailed runtime logs remain unavailable from this workspace because the Vercel CLI, project link, and access token are not configured.

A follow-up live check around 15:39 IST on 25 November 2026 again returned HTTP 200 for the page and provider-health route. The canonical URL was still `http://localhost:3000`, confirming the metadata fix has not reached production. `GET /api/aqi?city=Hyderabad` returned HTTP 200 from `bom1::bom1`, but the official result was `unavailable` with pagination status `rate_limited`; data.gov.in asked the adapter to stop after the first page. A previous request returned pagination status `overlap`, so the upstream failure varies between checks. The adapter withheld AQI in both cases.

After commit `312276b` was pushed to `main` on 26 November 2026, the production alias returned HTTP 200 with canonical URL `https://airwise-india-one.vercel.app`. The homepage sent the nonce-based CSP and same-origin security headers; the CSP nonce matched the rendered script/style markup and changed on a second request. `robots.txt`, `sitemap.xml`, `icon.svg`, and `/api/health/providers` each returned HTTP 200. The live `GET /api/aqi?city=Kakinada` returned HTTP 200 with pagination `complete`, but `official.status` was `unverified` and `aqi` was null because the source did not provide an explicit valid AQI field. AIRWISE correctly did not calculate or infer an index. The production AI generation route was not invoked.

## Project and build settings

In [Vercel](https://vercel.com/new), connect the GitHub account and import the existing private repository `surya066-git/airwise-india`. Select `main` for Production. Grant Vercel access to this private repository when prompted. `.gitignore` excludes `.env*` except `.env.example`; `.env.local` is not tracked. The reachable Git history was audited: it contains no environment files other than `.env.example`, and no configured secret values matched the committed files. The one authorization-header pattern detected by a heuristic is a synthetic provider error fixture in `lib/ai/gemini.test.ts`, covered by the header-redaction test.

### Dashboard connection steps

1. Sign in to Vercel and choose **Add New → Project**.
2. Import `surya066-git/airwise-india`; authorize Vercel to access the private repository if prompted.
3. Keep the detected Next.js framework, repository root, `npm` install detection from `package-lock.json`, `npm run build`, and the default Next.js output directory. Use Node.js `24.x`.
4. Before deploying, add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_AI_MODEL` in **Settings → Environment Variables**, with Production selected. Enter the secret directly into Vercel. Add Preview or Development values only when those environments should contact Cloudflare.
5. Deploy from `main`. After Vercel assigns the production origin, set `NEXT_PUBLIC_APP_URL` to that origin if canonical metadata should use it, then redeploy so the setting is included.
6. Record the actual deployment URL and follow the staged checks below. Do not use the assistant for a production generation smoke test until the user explicitly approves it.

Use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js (automatic detection is appropriate) |
| Root directory | Repository root containing `package.json` |
| Install command | Vercel automatic detection using `package-lock.json` |
| Build command | `npm run build` |
| Output directory | Vercel/Next.js default; do not override `.next` |
| Node.js | 24.x; `package.json` pins this tested major |
| Runtime | Node.js for `/api/aqi` and `/api/assistant` |
| Function region | Mumbai (`bom1`) for `/api/aqi` and `/api/assistant`, set in `vercel.json` |

The two data/assistant routes set `maxDuration = 300` seconds for bounded pagination, provider timeouts, and fallbacks. Ensure the Vercel project plan and Fluid Compute settings permit this duration. Vercel documents `maxDuration` for Next.js App Router segment configuration and the platform's plan/runtime limits in [Function duration configuration](https://vercel.com/docs/functions/configuring-functions/duration). Node 24 is supported and can be pinned with `engines.node` in [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Vercel detects Next.js, reads the package build script, and manages the output directory by default; see [Build configuration](https://vercel.com/docs/builds/configure-a-build).

The route files carry the Node runtime and execution duration settings. Vercel's per-function configuration in `vercel.json` places the two routes that call CPCB/data.gov.in in Mumbai (`bom1`). This follows Vercel's guidance to run functions close to their data source; see [Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region). The Next.js route-level `preferredRegion` option is deprecated in the installed Next.js 16.4.6 documentation, so region selection stays in Vercel configuration.

## Environment variables

Add variables under **Vercel Project → Settings → Environment Variables**. Type secret values directly into Vercel's UI or approved secret manager. Do not paste them into source control, deployment command arguments, issue trackers, or chat. Select the intended environment explicitly; Production, Preview, and Development are separate scopes, and changes apply to new deployments. Vercel documents these scopes in [Environment Variables](https://vercel.com/docs/environment-variables).

### Required for the Cloudflare primary provider

| Variable | Handling |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Server-only account identifier |
| `CLOUDFLARE_API_TOKEN` | Server-only secret; grant only the Workers AI permissions needed by this app |
| `CLOUDFLARE_AI_MODEL` | Set explicitly to the already tested model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

The adapter has a model default, but production should set all three explicitly. Never use a `NEXT_PUBLIC_` prefix for credentials.

### Optional source and fallback settings

Only set optional variables when intentionally enabling that service:

- `DATA_GOV_API_KEY` enables the existing CPCB/data.gov.in adapter. `DATA_GOV_RESOURCE_ID` is optional because the code already has a default resource ID. **This integration has not produced a verified official AQI:** inspected resource records lacked an explicit AQI field and sufficient units/averaging metadata. AIRWISE must keep AQI unavailable unless the source supplies a verifiable official AQI.
- `OPENAQ_API_KEY` enables supplementary raw readings when coordinates are available. They remain separate from official CPCB AQI.
- `GEMINI_API_KEY` and optional `GEMINI_MODEL` enable Gemini fallback. If configured, AIRWISE may send the user's question and selected preferences to Gemini after Cloudflare fails.
- `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL` enable OpenRouter fallback after earlier providers fail. An OpenRouter key was previously pasted into chat; rotate/revoke it before enabling this fallback if that has not already been done.
- Do not configure `OLLAMA_ENABLED`, `OLLAMA_BASE_URL`, or `OLLAMA_MODEL` in Vercel. Ollama is intentionally unavailable in production.
- `NEXT_PUBLIC_APP_URL` is a non-secret public origin used to generate the canonical metadata URL. Set it to the assigned production origin, for example `https://<your-production-domain>`. It may be set separately for Preview if Preview canonical URLs are desired.

Do not set `AIRWISE_LIVE_TEST_PROVIDER` or `AIRWISE_OFFLINE_TESTS` in Vercel. These are development-only test controls.

The local `.env.local` file does not populate Vercel automatically. Create each Vercel variable in the Production environment; add Preview values separately only if preview deployments should contact the same providers.

## Security review

- Provider credentials are read by server-side adapters; the browser uses same-origin API routes. The client components contain no direct provider authentication.
- The assistant and AQI inputs use Zod schemas; route request sizes and in-process request counts are bounded. Provider calls have explicit timeouts, bounded retries, and circuit breakers. API responses use `no-store`.
- API routes return safe error/status messages rather than stacks. Adapters do not log authorization headers, full prompts, or raw model responses.
- `/api/health/providers` only reads in-process configuration/circuit state. It makes no provider request and now omits raw last-failure codes and provider messages. It does not consume AI quota.
- The rate limiter is an in-memory map, so limits are per Node.js process and are not shared between Vercel instances. Configure Vercel Firewall rate limiting or add a shared rate-limit store before relying on it for public abuse prevention.
- `next.config.ts` sets `nosniff`, `Referrer-Policy`, frame denial, a restricted `Permissions-Policy`, and same-origin COOP/CORP headers. `proxy.ts` creates a per-request nonce for the homepage CSP; the homepage is dynamically rendered so the nonce and HTML stay aligned. Verify this policy again if adding third-party scripts, fonts, images, or API origins.
- `.gitignore` excludes `.env*` except `.env.example`. The one-commit Git history was scanned: `.env.example` is the only tracked environment-style file, no configured secret values matched committed files, and the sole header-shaped heuristic match is a mock diagnostic fixture in `lib/ai/gemini.test.ts`. This audit cannot prove whether credentials were exposed outside this repository; rotate any provider credential previously shared outside the approved secret manager before enabling it in Production.

## Production data behavior

The dashboard and assistant preserve separate CPCB and OpenAQ states. CPCB is the only source allowed to supply official AQI; AIRWISE will not calculate AQI from raw pollutant values. OpenAQ is supplementary raw measurement data, and stale readings remain marked historical. Missing data remains unavailable and must not be replaced by another city's values. The public Vercel deployment must be tested against these behaviors after environment setup.

## Staged verification

1. Verify the deployment URL serves the page over HTTPS.
2. Request `GET /api/health/providers`. It should return safe configuration/circuit metadata and make no outbound AI or source calls. Do not treat `configured: true` as proof that a provider responds successfully.
3. Check Vercel function logs for errors without enabling request-body or secret logging. Never copy tokens into diagnostic output.
4. A browser visit triggers the app's data route. That route can contact data.gov.in and, when coordinates plus an OpenAQ key are present, OpenAQ. Do not call it as a smoke test unless those source requests are intended.
5. A production assistant request consumes a Cloudflare generation request. **Obtain the user's explicit approval before the first production generation smoke test.** After approval, send exactly one question through the UI, record Cloudflare and route status plus the safe validation category, verify the actual frontend response and attribution, and stop after any failure. Do not retry or switch providers without new approval.
6. Keep fallback provider variables unset for the first production check if the test must be Cloudflare-only. The development-only Cloudflare override is not available in Production.

The Prompt 16 successful Cloudflare check was a local development-mode verification. It does not verify Vercel deployment, Vercel environment variables, Production function behavior, Production data providers, or a public URL.

## Locally verified for the 26 November 2026 release preparation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 20 files and 171 tests.
- `npm run build`: passed; Next.js generated the dynamically rendered, nonce-protected homepage and API route handlers.
- `npx playwright test --workers=1`: passed, 57 browser tests across mobile, tablet, and desktop; the dedicated test server used the offline guard and mocked browser API responses.
- `npm audit`: passed with zero reported vulnerabilities.
- Lighthouse on the local production build: Performance 99, Accessibility 100, Best Practices 100, SEO 100. A follow-up layout-shift observer reported no shifts after the initial loading state was adjusted.
- A production-mode local `GET /api/health/providers` returned HTTP 200 with four providers and safe projected metadata. Its route and unit test make no external requests; credentials and internal failure codes were absent.
- The configured secret values were compared in memory against repository source plus `.next/static` and `.next/server`; no matches were found. No values were printed. That earlier check did not scan Git history.

The current homepage CSP, metadata, security headers, static discovery files, and API availability were verified against the production alias after the source commit was pushed. No production AI generation was performed.

## Current deployment blockers

- Vercel project settings and detailed function logs are not accessible from this workspace. The Vercel CLI, project link, and access token are not configured; GitHub-to-Vercel deployment is active and the latest commit status completed successfully.
- The data.gov.in resource still does not provide an explicit valid AQI field at the required station and timestamp. The adapter deliberately fails closed; a verified AQI requires a supported source/API with explicit AQI and sufficient measurement metadata.
- The canonical URL and nonce-based CSP are confirmed live for this release. Recheck them after future changes to the homepage, CSP, or deployment configuration.
- The in-memory rate limiter is not distributed across serverless instances.
- Official CPCB AQI remains unresolved for the configured data.gov.in resource.
- A production AI generation remains gated on explicit user approval.
