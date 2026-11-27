# Code quality review

This report describes the repository implementation and the local checks run for this review. It makes no automated evaluation score claim.

## Architecture

| Boundary | Implementation |
| --- | --- |
| User interface | `components/` owns the dashboard, location and preference dialogs, assistant panel, and recommendation rendering. |
| HTTP boundary | `app/api/aqi/route.ts` and `app/api/assistant/route.ts` validate requests and shape safe responses. `app/api/health/providers/route.ts` exposes projected provider health only. |
| Environmental providers | `lib/aqi/cpcb.ts` and `lib/aqi/openaq.ts` parse independent provider responses; `lib/aqi/service.ts` coordinates them. |
| Recommendation logic | `lib/recommendations/engine.ts` builds deterministic daily suggestions from verified readings and selected preferences. |
| AI providers | `lib/ai/` keeps hosted and optional local provider calls on the server. `lib/ai/assistant.ts` coordinates validated provider results and deterministic fallback guidance. |
| Validation and shared contracts | `lib/validation/` contains request, provider-response, and recommendation checks; `types/` contains shared response and preference contracts. |
| Shared request utilities | `lib/utils/` bounds request bodies, applies local throttling, and implements timeouts/retries for provider requests. |

## Findings and changes

- **Fixed — stale location response race (`components/dashboard.tsx`):** refresh now aborts an older request, rejects late results, and only clears loading for the active request. A browser regression controls two location responses and verifies the final selection remains displayed.
- **Fixed — storage failure blocked first load (`components/dashboard.tsx`):** browser storage is optional; failed reads do not trigger a second failing cleanup operation, writes are contained, malformed locations are bounded and coordinate-checked, and a user-visible notice explains when a choice only lasts for the current visit.
- **Fixed — random API-test identities:** route tests now allocate request IPs deterministically instead of using `Math.random()`.
- **Improved — WCAG scan evidence:** Playwright runs axe-core checks against the dashboard and both dialogs at the configured mobile, tablet, and desktop viewports.
- **Known deployment limitation:** in-memory throttling is per Node.js process and is not a shared abuse-control limit. See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md).

## TypeScript and maintainability

- `tsconfig.json` enables `strict` mode. `npm run typecheck` first runs `next typegen`, then checks the application and tests; Next.js generated route declarations are ignored rather than committed.
- TypeScript also checks unused locals and parameters. Preference option tuples now define both the compile-time unions and the UI's select options, so the form and persisted-data validator share one contract.
- Browser-stored preferences and select changes are narrowed from `unknown`/`string` by runtime checks rather than assertions. Tests cover defaulting, malformed values, old `routine` migration, and saved form selections.
- The audited source contains no explicit `any`, `@ts-ignore`, `@ts-expect-error`, or lint-disable directives.
- API inputs and model responses are checked at runtime with Zod and semantic validation; provider payloads remain `unknown` until parsed.
- Error paths return safe status and guidance rather than stack traces. External fetches use fixed provider origins, explicit timeouts, bounded retries, and circuit breakers.
- Some files remain intentionally cohesive and sizeable: the dashboard combines related screen composition and display helpers, while CPCB pagination and recommendation safety validation have dense domain rules. Splitting these without a clear ownership or test benefit would add indirection. Revisit when those rules change independently.

## Verification

See [TESTING.md](./TESTING.md) for exact final command results, test counts, and the coverage limitation. `npm run build` is the production-configuration check; local success does not prove deployed provider credentials or upstream availability.
