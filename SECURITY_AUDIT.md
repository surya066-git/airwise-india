# Security audit

Scope: static review of application code and configuration, deterministic route/provider tests, and the npm dependency advisory report. No penetration test or production AI request was performed for this review.

## Controls observed

| Area | Current control and evidence |
| --- | --- |
| Credentials | Provider keys are read by server-side adapters. No provider key uses a `NEXT_PUBLIC_` variable. `/api/health/providers` returns allowlisted status fields, not credentials. `.env.local` values were not read into this report. |
| Request validation | Zod validates location, preference, message, and assistant request fields. `readJsonBody` enforces a 20 KB byte limit before JSON parsing, including when `Content-Length` is absent. |
| AI output | Provider JSON is parsed and checked against a shared schema plus provenance, personalization, AQI, pollutant, and unsupported medical-claim checks before it is returned. Invalid output falls back to visibly labelled standard guidance. |
| External calls | CPCB and OpenAQ origins are constants. Hosted AI endpoints are provider-owned. Optional Ollama accepts only loopback HTTP URLs and is disabled in production. Requests use explicit timeouts, limited retries, circuit breakers, and `no-store` responses. |
| Rendering and injection | Model and provider text is rendered as React text. The application does not use `dangerouslySetInnerHTML`. No wildcard CORS policy is configured. |
| Browser and transport policy | `next.config.ts` sets `nosniff`, strict referrer policy, frame denial, a restricted permissions policy, and same-origin COOP/CORP. `proxy.ts` adds a per-request nonce-based homepage CSP. |
| Errors and logs | Route errors are bounded and do not return stack traces. Provider adapters avoid logging prompts, raw model output, and authorization headers. |
| Dependency scan | Final `npm audit --json` result is recorded in [TESTING.md](./TESTING.md). |

## Findings and limits

### Process-local throttling

`lib/utils/rate-limit.ts` uses a bounded in-memory map. Limits reset independently in each Node.js process and cannot coordinate concurrent Vercel instances. Keep this as a per-process backstop, not the only public abuse control. Configure a deployment-level rate limit in Vercel Firewall or adopt a shared store before relying on a global request budget. Vercel documents its [request IP headers](https://vercel.com/docs/headers/request-headers) and [rate-limiting options](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk).

On Vercel, the platform-supplied forwarding IP is the intended key. On other hosting platforms, only trust a client-IP header that the trusted proxy strips and writes itself; arbitrary client-provided `X-Forwarded-For` is spoofable. Verify the deployed proxy chain before enabling this throttle outside Vercel.

### Credential-bearing CPCB query parameter

The data.gov.in endpoint accepts its API key as a query parameter. The adapter does not print request URLs or include the key in client responses, but upstream/proxy request logs can contain query strings. Keep provider URL logging disabled or redact the `api-key` parameter in any future observability integration.

### Public provider health

`GET /api/health/providers` is intentionally public and reports whether a provider is configured, its model name, and circuit state. It makes no network probe and returns no secrets. Treat it as operational metadata rather than proof that a provider is healthy. If deployment policy considers model names or provider configuration sensitive, restrict or further project this endpoint.

### Privacy and data handling

Location and optional preference choices remain in browser storage. When a user sends an assistant question, the server may send the question, recent conversation, selected preferences, and available verified source context to the configured provider. The UI states this before use. The product does not require an account or collect medical history. Avoid adding diagnoses or unnecessary personal data to provider prompts.

## Review limits

- `npm audit` covers advisories known to npm at scan time; it is not a source-code vulnerability proof.
- No live external APIs, credential checks, hosted generation, fuzzing, or penetration test were run.
- No distributed rate-limit service is configured in this repository. Production deployment owners must configure one at the edge or select a shared store.
