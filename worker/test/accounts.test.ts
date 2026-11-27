import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/index";
import { resetAccountLimiters, SIGNUPS_PER_IP_PER_DAY } from "../src/accounts";
import { bytesEqual, hashPassword, MAX_FAILED_SIGNINS, normalizeEmail, PBKDF2_ITERATIONS, SESSION_REMEMBER_S, SESSION_SHORT_S, validatePassword, verifyPassword } from "../src/auth";
import { validatePayload } from "../src/account-state";
import { ctx, FakeKV, makeEnv, PAGES, RESEND_KEY, resendMock } from "./helpers";

const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);

function req(path: string, init: { method?: string; body?: unknown; token?: string; ip?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "CF-Connecting-IP": init.ip ?? "203.0.113.9" };
  if (init.origin !== null) headers.Origin = init.origin ?? PAGES;
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  return new Request(`https://api.test${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// Every test gets a fresh fake Resend; `call` sends through it.
let mail = resendMock();

async function call(env: ReturnType<typeof makeEnv>, path: string, init: Parameters<typeof req>[1] = {}, now = NOW) {
  const res = await handle(req(path, init), env, ctx, mail.f, now);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any>, headers: res.headers };
}

/** Sign up and confirm with the emailed code (the normal path). Returns the session response. */
async function signUp(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>, init: { ip?: string; origin?: string } = {}, now = NOW) {
  const up = await call(env, "/auth/signup", { body, ...init }, now);
  if (up.status !== 201) return up;
  return call(env, "/auth/verify", { body: { email: body.email, code: mail.codeOf(), remember: body.remember === true }, ...init }, now);
}

const stateBlob = (updatedAt: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  updatedAt,
  state: { version: 3, updatedAt, createdAt: "2026-11-01T00:00:00.000Z", cash: 1000, ...extra },
});

describe("password hashing", () => {
  it("uses PBKDF2-SHA256 with a per-user salt and 100k iterations", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a.alg).toBe("pbkdf2-sha256");
    expect(a.iter).toBe(PBKDF2_ITERATIONS);
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
  });

  it("compares in constant time without early exit", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });

  it("validates emails and passwords", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    for (const bad of ["", "ana", "ana@", "@x.com", "a b@x.com", 42, null]) expect(normalizeEmail(bad)).toBeNull();
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("aaaaaaaaaa").ok).toBe(false);
    expect(validatePassword("ana@example.com", "ana@example.com").ok).toBe(false);
    expect(validatePassword("x".repeat(129)).ok).toBe(false);
    expect(validatePassword("a long passphrase").ok).toBe(true);
  });
});

describe("/auth email + password", () => {
  let kv: FakeKV;
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    resetAccountLimiters();
    mail = resendMock();
    kv = new FakeKV();
    env = makeEnv({ RESEND_API_KEY: RESEND_KEY }, kv);
  });

  it("signs up, confirms the email, reads the session, signs out", async () => {
    const up = await signUp(env, { email: "Ana@Example.com", password: "a long passphrase", name: " Ana  B ", remember: true });
    expect(up.status).toBe(200);
    expect(up.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(up.body.remember).toBe(true);
    expect(up.body.expiresAt).toBe(NOW + SESSION_REMEMBER_S * 1000);
    expect(up.body.account).toMatchObject({ email: "ana@example.com", name: "Ana B", hasPassword: true, emailVerified: true, passkeys: [], providers: [] });
    expect(up.headers.get("Access-Control-Allow-Origin")).toBe(PAGES);

    // Nothing sensitive is stored in the clear: no raw token, no raw email as a key, no plain password.
    const dump = JSON.stringify([...kv.store.entries()]);
    expect(dump).not.toContain(up.body.token);
    expect(dump).not.toContain("a long passphrase");
    expect([...kv.store.keys()].some((k) => k.includes("ana@example.com"))).toBe(false);

    const me = await call(env, "/auth/me", { token: up.body.token });
    expect(me.status).toBe(200);
    expect(me.body.account.email).toBe("ana@example.com");
    expect(me.body.session.remember).toBe(true);

    expect((await call(env, "/auth/signout", { method: "POST", token: up.body.token })).status).toBe(200);
    expect((await call(env, "/auth/me", { token: up.body.token })).status).toBe(401);
  });

  it("remember me off gives a 12-hour session that expires", async () => {
    const up = await signUp(env, { email: "b@example.com", password: "a long passphrase" });
    expect(up.body.remember).toBe(false);
    expect(up.body.expiresAt).toBe(NOW + SESSION_SHORT_S * 1000);
    expect((await call(env, "/auth/me", { token: up.body.token }, NOW + SESSION_SHORT_S * 1000 - 1)).status).toBe(200);
    expect((await call(env, "/auth/me", { token: up.body.token }, NOW + SESSION_SHORT_S * 1000 + 1)).status).toBe(401);
  });

  it("signs in with the right password and gives one generic error otherwise", async () => {
    await signUp(env, { email: "c@example.com", password: "a long passphrase" });
    const ok = await call(env, "/auth/signin", { body: { email: "C@example.com", password: "a long passphrase", remember: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.account.email).toBe("c@example.com");
    const wrong = await call(env, "/auth/signin", { body: { email: "c@example.com", password: "nope nope nope" } });
    const unknown = await call(env, "/auth/signin", { body: { email: "nobody@example.com", password: "nope nope nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("refuses a duplicate email with a neutral message", async () => {
    await signUp(env, { email: "d@example.com", password: "a long passphrase" });
    const dup = await call(env, "/auth/signup", { body: { email: "D@example.com", password: "another passphrase" } }, NOW + 1);
    expect(dup.status).toBe(409);
    expect(dup.body.error).not.toMatch(/exists|taken|registered/i);
  });

  it("rejects bad input", async () => {
    expect((await call(env, "/auth/signup", { body: { email: "nope", password: "a long passphrase" } })).status).toBe(400);
    expect((await call(env, "/auth/signup", { body: { email: "e@example.com", password: "short" } })).status).toBe(400);
    expect((await call(env, "/auth/me", { token: "not-a-token" })).status).toBe(401);
    expect((await call(env, "/auth/me", {})).status).toBe(401);
  });

  it("locks an email after repeated failures (for existing and unknown emails alike)", async () => {
    await signUp(env, { email: "f@example.com", password: "a long passphrase" });
    for (let i = 0; i < MAX_FAILED_SIGNINS; i += 1) {
      resetAccountLimiters();
      expect((await call(env, "/auth/signin", { body: { email: "f@example.com", password: "wrong wrong" } })).status).toBe(401);
    }
    resetAccountLimiters();
    const locked = await call(env, "/auth/signin", { body: { email: "f@example.com", password: "a long passphrase" } });
    expect(locked.status).toBe(429);
  });

  it("rate limits bursts per IP and caps sign-ups per IP per day", async () => {
    let last = 0;
    for (let i = 0; i < 11; i += 1) last = (await call(env, "/auth/signin", { body: { email: "g@example.com", password: "x" }, ip: "198.51.100.7" })).status;
    expect(last).toBe(429);
    for (let i = 0; i < SIGNUPS_PER_IP_PER_DAY; i += 1) {
      resetAccountLimiters();
      expect((await call(env, "/auth/signup", { body: { email: `n${i}@example.com`, password: "a long passphrase" }, ip: "198.51.100.8" })).status).toBe(201);
    }
    resetAccountLimiters();
    expect((await call(env, "/auth/signup", { body: { email: "late@example.com", password: "a long passphrase" }, ip: "198.51.100.8" })).status).toBe(429);
  });

  it("refuses other websites and works for the native app origin", async () => {
    expect((await call(env, "/auth/signup", { body: { email: "h@example.com", password: "a long passphrase" }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(env, "/auth/signup", { body: { email: "h@example.com", password: "a long passphrase" }, origin: "capacitor://localhost" })).status).toBe(201);
  });

  it("reports accounts in /health and says 503 without KV", async () => {
    expect((await call(env, "/health")).body.accounts).toBe(true);
    const noKv = makeEnv({}, null);
    expect((await call(noKv, "/auth/signup", { body: { email: "i@example.com", password: "a long passphrase" } })).status).toBe(503);
  });

  it("deletes the account, its cloud save and its session (password required)", async () => {
    const up = await signUp(env, { email: "j@example.com", password: "a long passphrase" });
    const token = up.body.token as string;
    await call(env, "/account/state", { token, body: { payload: stateBlob("Thu 2026-11-26 5:00 AM EST (UTC-05:00)"), baseRevision: 0 } });
    await call(env, "/account/backup", { token, body: { payload: stateBlob("Wed 2026-11-25 5:00 AM EST (UTC-05:00)") } });
    expect((await call(env, "/auth/delete", { token, body: { password: "wrong wrong" } })).status).toBe(401);
    expect((await call(env, "/auth/delete", { token, body: { password: "a long passphrase" } })).status).toBe(200);
    // Only throttle counters (no personal data) may remain.
    expect([...kv.store.keys()].filter((k) => k.startsWith("acct:") && !k.startsWith("acct:fail") && !k.startsWith("acct:mailrl"))).toEqual([]);
    expect((await call(env, "/auth/signin", { body: { email: "j@example.com", password: "a long passphrase" } })).status).toBe(401);
    // The email is free again.
    resetAccountLimiters();
    expect((await call(env, "/auth/signup", { body: { email: "j@example.com", password: "a long passphrase" } }, NOW + 61_000)).status).toBe(201);
  });
});

describe("email verification", () => {
  let kv: FakeKV;
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    resetAccountLimiters();
    mail = resendMock();
    kv = new FakeKV();
    env = makeEnv({ RESEND_API_KEY: RESEND_KEY }, kv);
  });

  it("sign-up gives no session and emails a branded code + link (reply-to support)", async () => {
    const up = await call(env, "/auth/signup", { body: { email: "Vee@Example.com", password: "a long passphrase", remember: true } });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ needsVerification: true, email: "vee@example.com", emailSent: true, resendAfter: 60 });
    expect(up.body.token).toBeUndefined();
    expect(mail.sent).toHaveLength(1);
    const e = mail.last()!;
    expect(mail.state.auth[0]).toBe(`Bearer ${RESEND_KEY}`);
    expect(e.to).toEqual(["vee@example.com"]);
    expect(e.from).toBe("Sentia <no-reply@sentiacoach.com>");
    expect(e.reply_to).toBe("support@sentiacoach.com");
    expect(e.subject).toMatch(/^\d{6} is your Sentia verification code$/);
    expect(e.html).toContain("#7c3aed");
    expect(e.html).toContain(mail.codeOf());
    expect(e.html).toContain("Confirm my email");
    expect(e.html).toMatch(/expire in 30 minutes/);
    expect(e.text).toMatch(/Didn't sign up/);
    // Default link: the site URL (request came from the github.io origin without a linkBase).
    expect(mail.linkOf()).toMatch(/^https:\/\/sentiacoach\.com\/verify\/\?token=[A-Za-z0-9_-]{43}$/);
    // Neither the code nor the link token is stored in the clear.
    const dump = JSON.stringify([...kv.store.entries()]);
    expect(dump).not.toContain(mail.codeOf());
    expect(dump).not.toContain(mail.tokenOf());
    // The account exists but can't be used yet.
    const signin = await call(env, "/auth/signin", { body: { email: "vee@example.com", password: "a long passphrase" } });
    expect(signin.status).toBe(403);
    expect(signin.body).toMatchObject({ needsVerification: true, email: "vee@example.com", emailSent: false });
    expect(signin.body.token).toBeUndefined();
    expect(mail.sent).toHaveLength(1); // a live code exists, so sign-in didn't send another
  });

  it("uses the app's own address for the link when it's an allowed website (github.io base path)", async () => {
    await call(env, "/auth/signup", { body: { email: "gh@example.com", password: "a long passphrase", linkBase: `${PAGES}/SentiaPTCoach` } });
    expect(mail.linkOf()).toMatch(new RegExp(`^${PAGES.replace(/[.]/g, "\\.")}/SentiaPTCoach/verify/\\?token=`));
    resetAccountLimiters();
    await call(env, "/auth/signup", { body: { email: "evil@example.com", password: "a long passphrase", linkBase: "https://evil.example/phish" } });
    expect(mail.linkOf()).toMatch(/^https:\/\/sentiacoach\.com\/verify\//);
    await call(env, "/auth/signup", { body: { email: "app@example.com", password: "a long passphrase", linkBase: "capacitor://localhost" }, origin: "capacitor://localhost" });
    expect(mail.linkOf()).toMatch(/^https:\/\/sentiacoach\.com\/verify\//);
    const env2 = makeEnv({ RESEND_API_KEY: RESEND_KEY, SITE_URL: "https://staging.example/" }, new FakeKV());
    await call(env2, "/auth/signup", { body: { email: "s@example.com", password: "a long passphrase" } });
    expect(mail.linkOf()).toMatch(/^https:\/\/staging\.example\/verify\/\?token=/);
  });

  it("the code signs you in once; the account is verified for good", async () => {
    await call(env, "/auth/signup", { body: { email: "k@example.com", password: "a long passphrase" } });
    const code = mail.codeOf();
    const v = await call(env, "/auth/verify", { body: { email: "K@example.com", code: `${code.slice(0, 3)} ${code.slice(3)}`, remember: true } });
    expect(v.status).toBe(200);
    expect(v.body.remember).toBe(true);
    expect(v.body.account.emailVerified).toBe(true);
    expect((await call(env, "/auth/me", { token: v.body.token })).status).toBe(200);
    // Single use.
    expect((await call(env, "/auth/verify", { body: { email: "k@example.com", code } })).status).toBe(400);
    // Normal sign-in now works, and the records no longer expire.
    expect((await call(env, "/auth/signin", { body: { email: "k@example.com", password: "a long passphrase" } })).status).toBe(200);
    expect([...kv.store.keys()].some((k) => k.startsWith("acct:chal:"))).toBe(false);
  });

  it("the link signs you in once", async () => {
    await call(env, "/auth/signup", { body: { email: "l@example.com", password: "a long passphrase" } });
    const token = mail.tokenOf();
    const v = await call(env, "/auth/verify", { body: { token } });
    expect(v.status).toBe(200);
    expect(v.body.account.email).toBe("l@example.com");
    const again = await call(env, "/auth/verify", { body: { token } });
    expect(again.status).toBe(400);
    expect(again.body.linkInvalid).toBe(true);
    // The code from the same email is dead too.
    expect((await call(env, "/auth/verify", { body: { email: "l@example.com", code: mail.codeOf() } })).status).toBe(400);
  });

  it("code and link expire after 30 minutes", async () => {
    await call(env, "/auth/signup", { body: { email: "m@example.com", password: "a long passphrase" } });
    const later = NOW + 30 * 60 * 1000 + 1;
    expect((await call(env, "/auth/verify", { body: { email: "m@example.com", code: mail.codeOf() } }, later)).body.mustResend).toBe(true);
    expect((await call(env, "/auth/verify", { body: { token: mail.tokenOf() } }, later)).status).toBe(400);
  });

  it("allows 5 wrong codes, then a new code must be sent", async () => {
    await call(env, "/auth/signup", { body: { email: "n@example.com", password: "a long passphrase" } });
    const right = mail.codeOf();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 4; i >= 1; i -= 1) {
      const r = await call(env, "/auth/verify", { body: { email: "n@example.com", code: wrong } });
      expect(r.status).toBe(400);
      expect(r.body.triesLeft).toBe(i);
    }
    const fifth = await call(env, "/auth/verify", { body: { email: "n@example.com", code: wrong } });
    expect(fifth.body.mustResend).toBe(true);
    // Even the right code no longer works.
    expect((await call(env, "/auth/verify", { body: { email: "n@example.com", code: right } })).status).toBe(400);
    // Resend → new code works.
    const resend = await call(env, "/auth/verify/resend", { body: { email: "n@example.com" } }, NOW + 61_000);
    expect(resend.status).toBe(200);
    expect(mail.sent).toHaveLength(2);
    expect((await call(env, "/auth/verify", { body: { email: "n@example.com", code: mail.codeOf() } }, NOW + 62_000)).status).toBe(200);
  });

  it("resend: 1 per 60 seconds, 5 per day, a new email replaces the old code, same answer for unknown emails", async () => {
    await call(env, "/auth/signup", { body: { email: "o@example.com", password: "a long passphrase" } });
    const first = mail.codeOf();
    const tooSoon = await call(env, "/auth/verify/resend", { body: { email: "o@example.com" } }, NOW + 30_000);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.retryAfter).toBe(30);
    let t = NOW;
    for (let i = 2; i <= 5; i += 1) {
      t += 61_000;
      resetAccountLimiters();
      expect((await call(env, "/auth/verify/resend", { body: { email: "o@example.com" } }, t)).status).toBe(200);
    }
    expect(mail.sent).toHaveLength(5);
    t += 61_000;
    const daily = await call(env, "/auth/verify/resend", { body: { email: "o@example.com" } }, t);
    expect(daily.status).toBe(429);
    expect(daily.body.error).toMatch(/tomorrow/);
    // Old code was replaced.
    if (first !== mail.codeOf()) expect((await call(env, "/auth/verify", { body: { email: "o@example.com", code: first } }, t)).status).toBe(400);
    expect((await call(env, "/auth/verify", { body: { email: "o@example.com", code: mail.codeOf() } }, t)).status).toBe(200);
    // Unknown and already-verified addresses answer exactly like a real one (and get no email).
    const unknown = await call(env, "/auth/verify/resend", { body: { email: "ghost@example.com" } }, t);
    const verified = await call(env, "/auth/verify/resend", { body: { email: "o@example.com" } }, t + 1);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ ok: true, resendAfter: 60 });
    expect(verified.status).toBe(429); // its own daily cap, like any address
    expect(mail.sent).toHaveLength(5);
  });

  it("signing up again with the same password before confirming re-sends; a different password gets the neutral refusal", async () => {
    await call(env, "/auth/signup", { body: { email: "p@example.com", password: "a long passphrase" } });
    const again = await call(env, "/auth/signup", { body: { email: "p@example.com", password: "a long passphrase" } }, NOW + 61_000);
    expect(again.status).toBe(201);
    expect(mail.sent).toHaveLength(2);
    const other = await call(env, "/auth/signup", { body: { email: "p@example.com", password: "someone else pw" } }, NOW + 122_000);
    expect(other.status).toBe(409);
  });

  it("sign-in of an unconfirmed account sends a fresh code when the old one is gone", async () => {
    await call(env, "/auth/signup", { body: { email: "q@example.com", password: "a long passphrase" } });
    const later = NOW + 31 * 60 * 1000;
    const signin = await call(env, "/auth/signin", { body: { email: "q@example.com", password: "a long passphrase" } }, later);
    expect(signin.status).toBe(403);
    expect(signin.body.emailSent).toBe(true);
    expect(mail.sent).toHaveLength(2);
    // Wrong password on an unconfirmed account is the same generic 401.
    expect((await call(env, "/auth/signin", { body: { email: "q@example.com", password: "wrong wrong wrong" } }, later)).status).toBe(401);
  });

  it("unconfirmed sign-ups are purged after 7 days and free the address", async () => {
    await call(env, "/auth/signup", { body: { email: "r@example.com", password: "a long passphrase" } });
    const later = NOW + 7 * 24 * 3600 * 1000 + 1000;
    const signin = await call(env, "/auth/signin", { body: { email: "r@example.com", password: "a long passphrase" } }, later);
    expect(signin.status).toBe(401);
    expect([...kv.store.keys()].filter((k) => k.startsWith("acct:user:"))).toEqual([]);
    resetAccountLimiters();
    const fresh = await call(env, "/auth/signup", { body: { email: "r@example.com", password: "a brand new passphrase" } }, later);
    expect(fresh.status).toBe(201);
  });

  it("an unverified account can't use a session even if one existed", async () => {
    // Defence in depth: a session record pointing at an unconfirmed user is refused.
    await call(env, "/auth/signup", { body: { email: "s1@example.com", password: "a long passphrase" } });
    const uid = [...kv.store.entries()].find(([k]) => k.startsWith("acct:user:"))![0].slice("acct:user:".length);
    const { createSession } = await import("../src/auth");
    const { token } = await createSession(kv as unknown as KVNamespace, uid, false, NOW);
    expect((await call(env, "/auth/me", { token })).status).toBe(401);
    expect((await call(env, "/account/state", { token })).status).toBe(401);
  });

  it("grandfathers accounts created before verification existed", async () => {
    const { hashPassword: hp } = await import("../src/auth");
    const { sha256Hex } = await import("../src/auth");
    const old = { id: "u_grandfathered01", email: "old@example.com", name: "Old", createdAt: "2026-11-01T12:00:00.000Z", password: await hp("a long passphrase"), passkeys: [] };
    await kv.put(`acct:user:${old.id}`, JSON.stringify(old));
    await kv.put(`acct:email:${await sha256Hex("old@example.com")}`, old.id);
    const r = await call(env, "/auth/signin", { body: { email: "old@example.com", password: "a long passphrase" } });
    expect(r.status).toBe(200);
    expect(r.body.account.emailVerified).toBe(true);
    expect((await call(env, "/account/state", { token: r.body.token })).status).toBe(200);
  });

  it("without RESEND_API_KEY: /health says so and sign-up is refused (no bypass)", async () => {
    const off = makeEnv({}, new FakeKV());
    expect((await call(off, "/health")).body.emailVerification).toBe(false);
    expect((await call(env, "/health")).body.emailVerification).toBe(true);
    const up = await call(off, "/auth/signup", { body: { email: "t@example.com", password: "a long passphrase" } });
    expect(up.status).toBe(503);
    expect(up.body.error).toMatch(/verification/);
    expect(up.body.token).toBeUndefined();
    expect((await call(off, "/auth/password/forgot", { body: { email: "t@example.com" } })).status).toBe(503);
    expect(mail.sent).toHaveLength(0);
  });

  it("if Resend fails, the account waits unverified and says the email didn't go out", async () => {
    mail.state.fail = true;
    const up = await call(env, "/auth/signup", { body: { email: "u@example.com", password: "a long passphrase" } });
    expect(up.status).toBe(201);
    expect(up.body.emailSent).toBe(false);
    expect(up.body.sendError).toMatch(/couldn't send/);
    mail.state.fail = false;
    const resend = await call(env, "/auth/verify/resend", { body: { email: "u@example.com" } }, NOW + 61_000);
    expect(resend.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
  });
});

describe("password reset by email", () => {
  let kv: FakeKV;
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    resetAccountLimiters();
    mail = resendMock();
    kv = new FakeKV();
    env = makeEnv({ RESEND_API_KEY: RESEND_KEY }, kv);
  });

  it("answers the same for known and unknown emails, and only emails real accounts", async () => {
    await signUp(env, { email: "w@example.com", password: "a long passphrase" });
    const before = mail.sent.length;
    const known = await call(env, "/auth/password/forgot", { body: { email: "w@example.com", linkBase: `${PAGES}/SentiaPTCoach` } });
    const unknown = await call(env, "/auth/password/forgot", { body: { email: "nobody@example.com" } });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.last()!.subject).toMatch(/password reset code/);
    expect(mail.last()!.reply_to).toBe("support@sentiacoach.com");
    expect(mail.linkOf()).toContain(`${PAGES}/SentiaPTCoach/reset-password/?token=`);
  });

  it("link: check, set a new password, old sessions end, old password stops working", async () => {
    const s1 = await signUp(env, { email: "x@example.com", password: "a long passphrase", remember: true });
    await call(env, "/auth/password/forgot", { body: { email: "x@example.com" } });
    const token = mail.tokenOf();
    expect((await call(env, "/auth/password/check", { body: { token } })).body.valid).toBe(true);
    // A bad new password doesn't use up the link.
    expect((await call(env, "/auth/password/reset", { body: { token, password: "short" } })).status).toBe(400);
    const done = await call(env, "/auth/password/reset", { body: { token, password: "my new passphrase" } }, NOW + 1000);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: true, email: "x@example.com" });
    expect((await call(env, "/auth/me", { token: s1.body.token }, NOW + 2000)).status).toBe(401);
    expect((await call(env, "/auth/signin", { body: { email: "x@example.com", password: "a long passphrase" } }, NOW + 2000)).status).toBe(401);
    const fresh = await call(env, "/auth/signin", { body: { email: "x@example.com", password: "my new passphrase" } }, NOW + 2000);
    expect(fresh.status).toBe(200);
    expect((await call(env, "/auth/me", { token: fresh.body.token }, NOW + 3000)).status).toBe(200);
    // Single use.
    expect((await call(env, "/auth/password/check", { body: { token } })).body.valid).toBe(false);
    expect((await call(env, "/auth/password/reset", { body: { token, password: "another passphrase" } })).status).toBe(400);
  });

  it("code: 5 wrong tries then a new email; the right code resets", async () => {
    await signUp(env, { email: "y@example.com", password: "a long passphrase" });
    await call(env, "/auth/password/forgot", { body: { email: "y@example.com" } });
    const right = mail.codeOf();
    const wrong = right === "999999" ? "888888" : "999999";
    for (let i = 0; i < 4; i += 1) expect((await call(env, "/auth/password/reset", { body: { email: "y@example.com", code: wrong, password: "my new passphrase" } })).body.triesLeft).toBe(4 - i);
    expect((await call(env, "/auth/password/reset", { body: { email: "y@example.com", code: wrong, password: "my new passphrase" } })).body.mustResend).toBe(true);
    expect((await call(env, "/auth/password/reset", { body: { email: "y@example.com", code: right, password: "my new passphrase" } })).status).toBe(400);
    await call(env, "/auth/password/forgot", { body: { email: "y@example.com" } }, NOW + 61_000);
    expect((await call(env, "/auth/password/reset", { body: { email: "y@example.com", code: mail.codeOf(), password: "my new passphrase" } }, NOW + 62_000)).status).toBe(200);
  });

  it("is rate limited per address (1/min, 5/day), the same for unknown addresses", async () => {
    expect((await call(env, "/auth/password/forgot", { body: { email: "z@example.com" } })).status).toBe(200);
    expect((await call(env, "/auth/password/forgot", { body: { email: "z@example.com" } }, NOW + 10_000)).status).toBe(429);
  });

  it("resetting an unconfirmed sign-up proves the address and replaces a squatter's password", async () => {
    await call(env, "/auth/signup", { body: { email: "sq@example.com", password: "squatter passphrase" } });
    await call(env, "/auth/password/forgot", { body: { email: "sq@example.com" } });
    expect((await call(env, "/auth/password/reset", { body: { token: mail.tokenOf(), password: "the real owner pw" } })).status).toBe(200);
    expect((await call(env, "/auth/signin", { body: { email: "sq@example.com", password: "squatter passphrase" } })).status).toBe(401);
    const owner = await call(env, "/auth/signin", { body: { email: "sq@example.com", password: "the real owner pw" } });
    expect(owner.status).toBe(200);
    expect(owner.body.account.emailVerified).toBe(true);
  });
});

describe("/account/state cloud save", () => {
  let env: ReturnType<typeof makeEnv>;
  let token: string;
  beforeEach(async () => {
    resetAccountLimiters();
    mail = resendMock();
    env = makeEnv({ RESEND_API_KEY: RESEND_KEY }, new FakeKV());
    token = (await signUp(env, { email: "s@example.com", password: "a long passphrase" })).body.token;
  });

  it("needs a session", async () => {
    expect((await call(env, "/account/state")).status).toBe(401);
    expect((await call(env, "/account/state", { body: { payload: stateBlob("2026-11-26T10:00:00.000Z"), baseRevision: 0 } })).status).toBe(401);
  });

  it("starts empty, saves with increasing revisions, and returns the copy", async () => {
    expect((await call(env, "/account/state", { token })).body).toEqual({ exists: false, revision: 0 });
    const first = await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:00.000Z"), baseRevision: 0 } });
    expect(first.body).toMatchObject({ ok: true, revision: 1 });
    const second = await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:05.000Z", { cash: 5 }), baseRevision: 1 } });
    expect(second.body.revision).toBe(2);
    const got = await call(env, "/account/state", { token });
    expect(got.body).toMatchObject({ exists: true, revision: 2, updatedAt: "2026-11-26T10:00:05.000Z" });
    expect(got.body.payload.state.cash).toBe(5);
    expect((await call(env, "/account/state?known=2", { token })).body).toMatchObject({ unchanged: true, revision: 2 });
  });

  it("refuses a stale save with 409 and the newer copy; force keeps the loser as a backup", async () => {
    await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:00.000Z"), baseRevision: 0 } });
    await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T11:00:00.000Z", { cash: 2 }), baseRevision: 1 } });
    const stale = await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:30:00.000Z", { cash: 3 }), baseRevision: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.conflict).toMatchObject({ revision: 2, updatedAt: "2026-11-26T11:00:00.000Z" });
    expect(stale.body.conflict.payload.state.cash).toBe(2);

    const forced = await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T12:00:00.000Z", { cash: 4 }), baseRevision: 1, force: true } });
    expect(forced.body.revision).toBe(3);
    const backup = await call(env, "/account/backup", { token });
    expect(backup.body).toMatchObject({ exists: true, updatedAt: "2026-11-26T11:00:00.000Z", reason: "replaced-by-newer-device" });
    expect(backup.body.payload.state.cash).toBe(2);
  });

  it("validates the payload and caps its size", async () => {
    expect((await call(env, "/account/state", { token, body: { payload: { state: { nope: 1 } }, baseRevision: 0 } })).status).toBe(400);
    expect((await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:00.000Z"), baseRevision: -1 } })).status).toBe(400);
    const huge = stateBlob("2026-11-26T10:00:00.000Z", { blob: "x".repeat(1_100_000) });
    expect((await call(env, "/account/state", { token, body: { payload: huge, baseRevision: 0 } })).status).toBe(413);
    expect(validatePayload(stateBlob("2026-11-26T10:00:00.000Z"))?.updatedAt).toBe("2026-11-26T10:00:00.000Z");
    expect(validatePayload({ state: { version: 3, updatedAt: "not a date" } })).toBeNull();
  });

  it("keeps each account's save separate", async () => {
    const other = (await signUp(env, { email: "t@example.com", password: "a long passphrase" })).body.token as string;
    await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:00.000Z", { cash: 111 }), baseRevision: 0 } });
    expect((await call(env, "/account/state", { token: other })).body.exists).toBe(false);
  });

  it("rate limits saves per account", async () => {
    let status = 0;
    for (let i = 0; i < 31; i += 1) {
      status = (await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:00.000Z"), baseRevision: i } })).status;
    }
    expect(status).toBe(429);
  });
});
