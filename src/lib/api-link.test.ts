import assert from "node:assert/strict";
import { test } from "node:test";
import { SENTIA_API_URL, SENTIA_COACH_API_URL, apiConfigured, healthSaysReady, probeSentiaCoachApi, usingSentiaCoachApi } from "./api-config";

test("healthSaysReady accepts only an ok worker", () => {
  assert.equal(healthSaysReady(200, { ok: true }), true);
  assert.equal(healthSaysReady(200, { ok: false }), false);
  assert.equal(healthSaysReady(503, { ok: true }), false);
  assert.equal(healthSaysReady(200, null), false);
  assert.equal(healthSaysReady(200, "ok"), false);
});

test("the built-in API is api.sentiacoach.com and stays off until /health says ok", async () => {
  assert.equal(process.env.NEXT_PUBLIC_SENTIA_API_URL ?? "", "");
  assert.equal(SENTIA_COACH_API_URL, "https://api.sentiacoach.com");
  assert.equal(SENTIA_API_URL, SENTIA_COACH_API_URL);
  assert.equal(usingSentiaCoachApi(), true);
  assert.equal(apiConfigured(), false);

  const down = await probeSentiaCoachApi(async () => new Response("nope", { status: 503 }));
  assert.equal(down, false);
  assert.equal(apiConfigured(), false);

  const up = await probeSentiaCoachApi(async () => Response.json({ ok: true, quotes: { finnhub: false } }));
  assert.equal(up, true);
  assert.equal(apiConfigured(), true);

  const again = await probeSentiaCoachApi(async () => {
    throw new Error("should not probe again once linked");
  });
  assert.equal(again, true);
});
