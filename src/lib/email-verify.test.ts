import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanCode,
  clearPendingVerification,
  isVerificationNeeded,
  readPendingVerification,
  secondsUntil,
  tokenFromLocation,
  VERIFY_PENDING_KEY,
  writePendingVerification,
} from "./sentia-accounts";

class MemStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

test("cleanCode keeps only six digits from typed or pasted codes", () => {
  assert.equal(cleanCode("123 456"), "123456");
  assert.equal(cleanCode("123-456"), "123456");
  assert.equal(cleanCode("Your code: 987654."), "987654");
  assert.equal(cleanCode("12345678"), "123456");
  assert.equal(cleanCode("abc"), "");
});

test("tokenFromLocation reads ?token= or #token= and ignores junk", () => {
  const t = "A".repeat(43);
  assert.equal(tokenFromLocation(`?token=${t}`), t);
  assert.equal(tokenFromLocation("", `#token=${t}`), t);
  assert.equal(tokenFromLocation("?token=short"), null);
  assert.equal(tokenFromLocation(`?token=${t}<script>`), null);
  assert.equal(tokenFromLocation(""), null);
});

test("secondsUntil counts down and never goes negative", () => {
  assert.equal(secondsUntil(10_500, 0), 11);
  assert.equal(secondsUntil(1000, 1000), 0);
  assert.equal(secondsUntil(0, 5000), 0);
});

test("isVerificationNeeded recognises the server's check-your-email answer", () => {
  assert.equal(isVerificationNeeded({ needsVerification: true, email: "a@b.co", emailSent: true, resendAfter: 60 }), true);
  assert.equal(isVerificationNeeded({ token: "x" }), false);
  assert.equal(isVerificationNeeded(null), false);
});

test("pending verification survives a reload (tab + device), keeps Remember me, expires after a day", () => {
  const stores = { local: new MemStorage(), session: new MemStorage() };
  const now = 1_000_000;
  writePendingVerification(stores, { email: "ana@example.com", remember: true, resendAt: now + 60_000 });
  assert.ok(stores.local.getItem(VERIFY_PENDING_KEY));
  assert.ok(stores.session.getItem(VERIFY_PENDING_KEY));
  assert.deepEqual(readPendingVerification(stores, now), { email: "ana@example.com", remember: true, resendAt: now + 60_000 });
  // The link may open in a new tab: localStorage alone is enough.
  stores.session.removeItem(VERIFY_PENDING_KEY);
  assert.equal(readPendingVerification(stores, now)?.remember, true);
  assert.equal(readPendingVerification(stores, now + 25 * 3600 * 1000), null);
  clearPendingVerification(stores);
  assert.equal(readPendingVerification(stores, now), null);
  stores.local.setItem(VERIFY_PENDING_KEY, "{not json");
  assert.equal(readPendingVerification(stores, now), null);
});
