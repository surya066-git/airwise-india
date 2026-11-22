# AIRWISE INDIA — Vercel Deployment and Production Test Guide

## Status

Local production build and automated tests are the evidence available for this workspace. A Vercel deployment has not been created or verified. This checkout has no Git metadata, no `.vercel/project.json`, and no Vercel CLI, so its project association and Production environment variables cannot be inspected here. Do not claim a public URL until Vercel returns one for a successful deployment.

## Project and build settings

Create a Git repository containing this project root, push it to a Git provider, and import it as a Vercel project. `.gitignore` excludes `.env*` except `.env.example`; keep `.env.local` out of the repository. This workspace has no `.git` directory, so its commit history and tracked-file status cannot be audited here. After creating the repository, verify the ignore rule and inspect the staged file list before the first push.

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

The two data/assistant routes set `maxDuration = 300` seconds for bounded pagination, provider timeouts, and fallbacks. Ensure the Vercel project plan and Fluid Compute settings permit this duration. Vercel documents `maxDuration` for Next.js App Router segment configuration and the platform's plan/runtime limits in [Function duration configuration](https://vercel.com/docs/functions/configuring-functions/duration). Node 24 is supported and can be pinned with `engines.node` in [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Vercel detects Next.js, reads the package build script, and manages the output directory by default; see [Build configuration](https://vercel.com/docs/builds/configure-a-build).

No `vercel.json` is needed for the current Next.js setup. The route files carry the Node runtime and execution duration settings.

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
- Baseline security headers are set in `next.config.ts` (`nosniff`, `Referrer-Policy`, frame denial, and a geolocation `Permissions-Policy`).
- `.gitignore` excludes `.env*` except `.env.example`, but absence of Git metadata means repository history, staging, and previously tracked-secret status could not be checked here. Rotate any provider credential that was exposed before enabling it in Production.

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

## Locally verified for this release preparation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 17 files and 154 tests.
- `npm run build`: passed; Next.js generated the dashboard and API route handlers.
- `npm run test:e2e -- --workers=1`: passed, 39 tests across mobile, tablet, and desktop; the dedicated test server used the offline guard and mocked browser API responses.
- A production-mode local `GET /api/health/providers` returned HTTP 200 with four providers and safe projected metadata. Its route and unit test make no external requests; credentials and internal failure codes were absent.
- The configured secret values were compared in memory against repository source plus `.next/static` and `.next/server`; no matches were found. No values were printed. Git history could not be scanned because this checkout has no `.git` metadata.

These checks establish local readiness only. No Vercel build, deployment, production environment-variable lookup, production data-source call, or production AI generation was performed.

## Current deployment blockers

- No Vercel project is linked and no Vercel CLI is installed in this workspace.
- No Git repository is present, so Vercel's Git integration cannot be imported until a repository is created and pushed.
- Vercel Production environment-variable presence and project plan/function settings are unknown.
- The in-memory rate limiter is not distributed across serverless instances.
- Official CPCB AQI remains unresolved for the configured data.gov.in resource.
- No production URL or production smoke-test result exists. A production AI generation remains gated on explicit user approval.
