# Testing report

## Test layers

- **Unit and adapter tests:** `lib/**/*.test.ts` cover CPCB parsing and pagination, OpenAQ station/sensor/timestamp matching, AQI categories, recommendation behavior, semantic advice validation, request limits, retries, circuit breakers, and AI provider failure/validation behavior.
- **Route tests:** `app/api/aqi/route.test.ts`, `app/api/assistant/route.test.ts`, and `app/api/health/providers/route.test.ts` exercise malformed input, missing credentials, safe fallbacks, unavailable data, provider errors, and credential redaction.
- **Browser tests:** `e2e/dashboard.spec.ts` runs Chromium at the configured 390×844, 768×1024, and 1440×900 viewports. The Playwright server enables `AIRWISE_OFFLINE_TESTS`; UI responses are mocked where needed and external provider requests are not part of this suite.
- **Accessibility scans:** `e2e/accessibility.spec.ts` runs axe-core against the dashboard, location dialog, and preferences dialog at all configured viewports.
- **Live integration suites:** `e2e-live/` is separately gated. It is not part of `npm test` or `npm run test:e2e`; no live integration is implied by the deterministic test results.

## Final local verification

Results will be filled from the completed post-change run. Do not infer coverage or live-provider success from a passing mock suite.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed: `next typegen` generated route definitions, then TypeScript completed with no errors. |
| `npm run lint` | Passed after the application and test changes. |
| `npm test` | Passed: 20 files, 172 tests; 20.41 seconds in the final recorded warm run. |
| `npm run build` | Passed on final code state with Next.js 16.4.6; App Router page and API routes built successfully. |
| `npm run test:e2e -- --workers=1` | Passed: 72 browser tests across mobile, tablet, and desktop in 11.2 minutes. No live providers were called. |
| `npm audit --json` | Passed: zero reported vulnerabilities across 487 dependency entries. |

## Coverage and determinism

The project does not configure a coverage provider, so no line or branch percentage is reported. Tests assert behavior at provider boundaries and use deterministic fixtures; API route tests use sequential deterministic client identities. Live tests require explicit environment flags and credentials and may contact external services, so they were not run as part of local regression verification.

Vitest currently starts an isolated worker for each of the 20 test files. Its own run summary estimates a modest speed gain without isolation, but the suite intentionally retains file isolation to prevent provider mocks and module-level circuit/rate-limit state from leaking between files. The recorded warm run completed in 21.18 seconds; no isolation change was made without a separate leak-safety benchmark.
