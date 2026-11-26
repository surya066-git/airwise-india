import { describe, expect, it } from "vitest";
import { readJsonBody } from "@/lib/utils/read-json-body";

function jsonRequest(body: string, headers?: HeadersInit): Request {
  return new Request("https://airwise.example/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
    body
  });
}

describe("readJsonBody", () => {
  it("parses a JSON request within the byte limit", async () => {
    const result = await readJsonBody(jsonRequest('{"question":"walk"}'), 100);
    expect(result).toEqual({ ok: true, value: { question: "walk" } });
  });

  it("rejects an oversized body based on Content-Length", async () => {
    const result = await readJsonBody(jsonRequest('{"question":"walk"}', { "content-length": "101" }), 100);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("enforces the limit when Content-Length is absent or inaccurate", async () => {
    const absent = await readJsonBody(jsonRequest("x".repeat(101)), 100);
    const inaccurate = await readJsonBody(jsonRequest("x".repeat(101), { "content-length": "1" }), 100);
    expect(absent).toEqual({ ok: false, reason: "too_large" });
    expect(inaccurate).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects invalid JSON and invalid UTF-8", async () => {
    const invalidJson = await readJsonBody(jsonRequest("not json"), 100);
    const invalidUtf8 = new Request("https://airwise.example/api/assistant", {
      method: "POST",
      body: new Uint8Array([0xc3, 0x28])
    });
    expect(invalidJson).toEqual({ ok: false, reason: "invalid_json" });
    expect(await readJsonBody(invalidUtf8, 100)).toEqual({ ok: false, reason: "invalid_json" });
  });
});
