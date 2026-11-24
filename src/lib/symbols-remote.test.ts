import assert from "node:assert/strict";
import { test } from "node:test";

// The API base URL is read when api-config loads, so set it before importing.
process.env.NEXT_PUBLIC_SENTIA_API_URL = "https://api.example.com";
const load = () => import("./symbols");

test("searchRemoteSymbols skips /search when /health doesn't list it", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true, quotes: { finnhub: true } }), { status: 200 });
  }) as typeof fetch;
  try {
    const { resetRemoteSearchState, searchRemoteSymbols } = await load();
    resetRemoteSearchState();
    assert.deepEqual(await searchRemoteSymbols("nvidia"), []);
    assert.deepEqual(await searchRemoteSymbols("apple"), []);
    assert.deepEqual(calls, ["https://api.example.com/health"]); // asked once, never hit /search
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("searchRemoteSymbols uses /search when /health lists it", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    const body = u.endsWith("/health") ? { ok: true, search: true } : { results: [{ symbol: "NVDA", name: "NVIDIA Corp" }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const { resetRemoteSearchState, searchRemoteSymbols } = await load();
    resetRemoteSearchState();
    assert.deepEqual(await searchRemoteSymbols("nvidia"), [{ symbol: "NVDA", name: "NVIDIA Corp" }]);
    assert.equal(calls.filter((c) => c.endsWith("/health")).length, 1);
    assert.equal(calls.filter((c) => c.includes("/search?q=nvidia")).length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

