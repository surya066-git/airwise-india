import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/providers/route";
import { resetGeminiCircuitForTests } from "@/lib/ai/gemini";
import { resetOpenRouterForTests } from "@/lib/ai/openrouter";
import { resetOllamaCircuitForTests } from "@/lib/ai/ollama";

afterEach(() => {
  vi.unstubAllEnvs();
  resetGeminiCircuitForTests();
  resetOpenRouterForTests();
  resetOllamaCircuitForTests();
});

describe("GET /api/health/providers", () => {
  it("reports safe provider state without credentials or contacting services", async () => {
    vi.stubEnv("GEMINI_API_KEY", "sensitive-test-key");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cloudflare-test-secret");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-test-secret");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    vi.stubEnv("OLLAMA_MODEL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const payload = await response.json();

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.providers.gemini).toMatchObject({ configured: true, state: "closed" });
    expect(payload.providers.cloudflare).toMatchObject({
      configured: true, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", state: "closed"
    });
    expect(payload.providers.openrouter).toMatchObject({ configured: true, model: "openrouter/free", state: "closed" });
    expect(payload.providers.ollama).toMatchObject({ configured: false, state: "closed" });
    for (const provider of Object.values(payload.providers)) {
      expect(provider).not.toHaveProperty("lastFailureCode");
      expect(provider).not.toHaveProperty("providerMessage");
      expect(provider).not.toHaveProperty("nextAttemptAt");
    }
    expect(JSON.stringify(payload)).not.toContain("sensitive-test-key");
    expect(JSON.stringify(payload)).not.toContain("cloudflare-test-secret");
    expect(JSON.stringify(payload)).not.toContain("openrouter-test-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
