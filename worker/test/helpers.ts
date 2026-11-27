/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in tests */
import type { Env } from "../src/env";

/** Minimal in-memory KV with the subset of the API the Worker uses. */
export class FakeKV {
  store = new Map<string, string>();
  writes = 0;
  async get(key: string, type?: "json"): Promise<unknown> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.writes += 1;
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list({ prefix = "", limit = 1000 }: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name }));
    return { keys, list_complete: true, cursor: "" };
  }
}

export function makeEnv(overrides: Partial<Env> = {}, kv: FakeKV | null = new FakeKV()): Env {
  return { ...(kv ? { SENTIA_KV: kv as unknown as KVNamespace } : {}), ...overrides };
}

export const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined) };

export type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch mock that routes by URL substring and records calls. */
export function mockFetch(routes: [string, Route][]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    for (const [match, route] of routes) if (url.includes(match)) return route(url, init);
    return new Response("not mocked", { status: 599 });
  }) as typeof fetch;
  return { f, calls };
}

export const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      // Split mid-line on purpose to exercise buffering.
      const all = lines.join("\n") + "\n";
      const mid = Math.floor(all.length / 2);
      c.enqueue(enc.encode(all.slice(0, mid)));
      c.enqueue(enc.encode(all.slice(mid)));
      c.close();
    },
  });
}

export const PAGES = "https://christiandemarco447267-dotcom.github.io";

// ---- email (Resend) test double ---------------------------------------------------------

export type SentEmail = { from: string; to: string[]; reply_to?: string; subject: string; html: string; text: string };

/** A fake Resend API: records every email; `fail` makes the next sends fail. Other URLs go to `next`. */
export function resendMock(next?: typeof fetch) {
  const sent: SentEmail[] = [];
  const state = { fail: false, auth: [] as string[] };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      state.auth.push(new Headers(init?.headers).get("Authorization") ?? "");
      if (state.fail) return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
      sent.push(JSON.parse(String(init?.body)) as SentEmail);
      return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200 });
    }
    if (next) return next(input, init);
    return new Response("not mocked", { status: 599 });
  }) as typeof fetch;
  const last = () => sent[sent.length - 1];
  const codeOf = (e: SentEmail | undefined = last()) => e?.text.match(/Your code: (\d{6})/)?.[1] ?? "";
  const tokenOf = (e: SentEmail | undefined = last()) => e?.text.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1] ?? "";
  const linkOf = (e: SentEmail | undefined = last()) => e?.text.match(/https?:\/\/\S+token=[A-Za-z0-9_-]+/)?.[0] ?? "";
  return { f, sent, state, last, codeOf, tokenOf, linkOf };
}

export const RESEND_KEY = "re_test_123";

/**
 * Create an email + password account the way a person does: sign up, read the code from the
 * (fake) verification email, confirm it. Returns the /auth/verify response (the session).
 */
export async function signUpAndVerify(
  env: Env,
  body: { email: string; password: string; name?: string; remember?: boolean },
  opts: { now: number; origin?: string; ip?: string; next?: typeof fetch },
): Promise<{ status: number; body: Record<string, any> }> {
  const { handle } = await import("../src/index");
  if (!env.RESEND_API_KEY) env.RESEND_API_KEY = RESEND_KEY;
  const mail = resendMock(opts.next);
  const post = async (path: string, payload: unknown) => {
    const res = await handle(
      new Request(`https://api.test${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: opts.origin ?? PAGES, "CF-Connecting-IP": opts.ip ?? "203.0.113.99" },
        body: JSON.stringify(payload),
      }),
      env,
      ctx,
      mail.f,
      opts.now,
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const up = await post("/auth/signup", body);
  if (up.status !== 201) return up;
  return post("/auth/verify", { email: body.email, code: mail.codeOf(), remember: body.remember === true });
}
