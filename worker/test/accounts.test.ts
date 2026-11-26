import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/index";
import { resetAccountLimiters, SIGNUPS_PER_IP_PER_DAY } from "../src/accounts";
import { bytesEqual, hashPassword, MAX_FAILED_SIGNINS, normalizeEmail, PBKDF2_ITERATIONS, SESSION_REMEMBER_S, SESSION_SHORT_S, validatePassword, verifyPassword } from "../src/auth";
import { validatePayload } from "../src/account-state";
import { ctx, FakeKV, makeEnv, PAGES } from "./helpers";

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

async function call(env: ReturnType<typeof makeEnv>, path: string, init: Parameters<typeof req>[1] = {}, now = NOW) {
  const res = await handle(req(path, init), env, ctx, fetch, now);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any>, headers: res.headers };
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
    kv = new FakeKV();
    env = makeEnv({}, kv);
  });

  it("signs up, reads the session, signs out", async () => {
    const up = await call(env, "/auth/signup", { body: { email: "Ana@Example.com", password: "a long passphrase", name: " Ana  B ", remember: true } });
    expect(up.status).toBe(201);
    expect(up.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(up.body.remember).toBe(true);
    expect(up.body.expiresAt).toBe(NOW + SESSION_REMEMBER_S * 1000);
    expect(up.body.account).toMatchObject({ email: "ana@example.com", name: "Ana B", hasPassword: true, passkeys: [], providers: [] });
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
    const up = await call(env, "/auth/signup", { body: { email: "b@example.com", password: "a long passphrase" } });
    expect(up.body.remember).toBe(false);
    expect(up.body.expiresAt).toBe(NOW + SESSION_SHORT_S * 1000);
    expect((await call(env, "/auth/me", { token: up.body.token }, NOW + SESSION_SHORT_S * 1000 - 1)).status).toBe(200);
    expect((await call(env, "/auth/me", { token: up.body.token }, NOW + SESSION_SHORT_S * 1000 + 1)).status).toBe(401);
  });

  it("signs in with the right password and gives one generic error otherwise", async () => {
    await call(env, "/auth/signup", { body: { email: "c@example.com", password: "a long passphrase" } });
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
    await call(env, "/auth/signup", { body: { email: "d@example.com", password: "a long passphrase" } });
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
    await call(env, "/auth/signup", { body: { email: "f@example.com", password: "a long passphrase" } });
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
    const up = await call(env, "/auth/signup", { body: { email: "j@example.com", password: "a long passphrase" } });
    const token = up.body.token as string;
    await call(env, "/account/state", { token, body: { payload: stateBlob("2026-11-26T10:00:00.000Z"), baseRevision: 0 } });
    await call(env, "/account/backup", { token, body: { payload: stateBlob("2026-11-25T10:00:00.000Z") } });
    expect((await call(env, "/auth/delete", { token, body: { password: "wrong wrong" } })).status).toBe(401);
    expect((await call(env, "/auth/delete", { token, body: { password: "a long passphrase" } })).status).toBe(200);
    expect([...kv.store.keys()].filter((k) => k.startsWith("acct:") && !k.startsWith("acct:fail"))).toEqual([]);
    expect((await call(env, "/auth/signin", { body: { email: "j@example.com", password: "a long passphrase" } })).status).toBe(401);
    // The email is free again.
    resetAccountLimiters();
    expect((await call(env, "/auth/signup", { body: { email: "j@example.com", password: "a long passphrase" } })).status).toBe(201);
  });
});

describe("/account/state cloud save", () => {
  let env: ReturnType<typeof makeEnv>;
  let token: string;
  beforeEach(async () => {
    resetAccountLimiters();
    env = makeEnv({}, new FakeKV());
    token = (await call(env, "/auth/signup", { body: { email: "s@example.com", password: "a long passphrase" } })).body.token;
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
    const other = (await call(env, "/auth/signup", { body: { email: "t@example.com", password: "a long passphrase" } })).body.token as string;
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
