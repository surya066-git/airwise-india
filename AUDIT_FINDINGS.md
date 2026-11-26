# AIRWISE INDIA — Repository Audit Findings

This report records the baseline audit before implementation changes. Findings are limited to observed behavior and deployment constraints; a recommendation is not presented as an implemented control.

## Baseline findings

| ID | Category | Severity | Affected area | Finding and technical effect | Recommended correction | Relevant evidence |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Data integrity / client state | High | `components/dashboard.tsx` (`refresh`, `applyLocation`) | Refreshes are not cancelled or ordered. If a request for one location resolves after a later location request, its response can replace the selected location's readings. | Abort superseded requests and only apply results from the active request. Cover out-of-order responses in browser tests. | Playwright test selecting two locations with controlled response order; verify the selected location and displayed source data stay aligned. |
| F-02 | Reliability / client state | Medium | `components/dashboard.tsx` (local storage restore) | If accessing browser storage throws, the catch path calls `localStorage.removeItem`, which can throw the same way and prevents the initial AQI request from starting. | Treat storage as optional and isolate reads, writes, and cleanup failures so the app still loads for the current visit. | Browser test with storage access disabled; verify the dashboard still requests and renders the API response. |
| F-03 | Test determinism | Low | `app/api/aqi/route.test.ts`, `app/api/assistant/route.test.ts` | Test request helpers use `Math.random()` to avoid rate-limit key collisions. Random keys make requests non-reproducible and retain a low-probability collision path. | Use a deterministic, monotonically increasing test IP per request. | Unit tests run repeatedly with identical generated request identities and expected behavior. |
| F-04 | Accessibility evidence | Medium | E2E test configuration and `e2e/` | Existing browser checks cover navigation, focus, labels, responsive layout, and source states, but the repository has no automated WCAG rule scan. | Add a reproducible axe scan for the dashboard and open dialogs, then record scan coverage and manual checks without claiming full conformance. | Axe Playwright results plus existing keyboard and responsive browser tests. |
| F-05 | Abuse prevention / deployment | Medium | `lib/utils/rate-limit.ts`, API routes, Vercel configuration | Request throttling is a bounded in-process map. It is not shared across Node.js workers or serverless instances, so it is not a distributed abuse-control boundary. Non-Vercel deployments must also ensure forwarding headers are set by a trusted proxy before using them as client identity. | Keep the in-process guard as a local backstop. Configure Vercel Firewall rate limits or a shared store at deployment; trust only proxy-sanitized client-IP headers. | `lib/utils/rate-limit.test.ts`; Vercel request-header and Firewall rate-limit documentation. |
| F-06 | Evaluation evidence / maintainability | Medium | Project documentation | The repository explains architecture and prompt history, but it has no concise category reports or requirement-to-UI-to-test traceability matrix for the requested evaluation. | Add factual code quality, security, testing, accessibility, and problem-alignment reports; update README and prompt-flow documentation with current local evidence and explicit limits. | Documentation links to implementation paths and named test files; local command results. |
| F-07 | Problem alignment / product completeness | Medium | `lib/recommendations/engine.ts` indoor recommendation | The initial indoor-air steps covered smoke, cooking, ventilation, and filtration, but did not give a practical cleaning routine requested by the challenge. | Add a conservative dust-control practice and a behavior-focused unit test. | `lib/recommendations/engine.test.ts`; indoor coach in `components/dashboard.tsx`. |

## Baseline checks

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 20 test files and 171 tests. Vitest reported 20 worker isolates and a 47.96 second test duration.
- `npm audit --json`: zero reported vulnerabilities across 483 installed dependencies.
- `npm run build`: passed on Next.js 16.4.6; app and API routes built successfully.
- `npm run test:e2e -- --workers=1`: the unmodified baseline run was stopped after 6 browser cases passed because the 57-case, three-viewport suite was still running; the complete suite is reserved for post-change verification.

## Baseline strengths confirmed

- TypeScript `strict` mode is enabled; baseline typecheck and lint pass.
- The audited source contains no `any`, `@ts-ignore`, `@ts-expect-error`, or lint-disable directives.
- API inputs use Zod validation and the assistant JSON body is byte-limited before parsing.
- Provider credentials are read by server adapters; source/model output is structurally and semantically validated before display.
- CPCB and OpenAQ results retain separate provenance and timestamps. AIRWISE does not derive official AQI from pollutant values.
- Security headers, nonce-based homepage CSP, bounded upstream requests, timeouts, retry limits, and circuit breakers are present.
- The existing UI exposes textual source states and status labels, keyboard focus styling, a skip link, dialog focus handling, and reduced-motion behavior.

## Implementation status after the audit

- **Fixed:** F-01 through F-04 and F-06. The two client-state defects and nondeterministic test identity generation were corrected; axe scans were added and their first finding was fixed; the requested audit reports and traceability matrix were added.
- **Fixed:** F-07. Indoor guidance now includes damp dusting/wet mopping and avoids dry sweeping; a focused unit test asserts the steps.
- **Deployment action remains:** F-05. The application keeps its bounded process-local throttle, but shared rate limiting requires deployment configuration or a shared external store and cannot be enabled from this repository alone.
