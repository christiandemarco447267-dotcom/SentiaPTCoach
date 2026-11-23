// Bindings and settings available to the Worker. Everything is optional so the
// Worker degrades feature-by-feature instead of failing as a whole.
export interface Env {
  /** KV namespace for feedback, rate-limit counters and daily usage counts. */
  SENTIA_KV?: KVNamespace;

  // ---- secrets (npx wrangler secret put NAME) ----
  FINNHUB_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** Long random string; required to read feedback and usage stats. */
  ADMIN_TOKEN?: string;
  /** Optional Discord or Slack incoming-webhook URL that receives each feedback message. */
  FEEDBACK_WEBHOOK_URL?: string;
  /** Optional background price alerts (Web Push). Private key: base64url P-256 "d" (secret). */
  VAPID_PRIVATE_KEY?: string;
  /** Public key (base64url, uncompressed P-256); the same value goes in NEXT_PUBLIC_VAPID_PUBLIC_KEY. */
  VAPID_PUBLIC_KEY?: string;

  // ---- plain vars (wrangler.toml [vars]) ----
  ALLOWED_ORIGINS?: string;
  COACH_PROVIDER?: string;
  COACH_MODEL?: string;
  COACH_DAILY_LIMIT_PER_IP?: string;
  COACH_DAILY_LIMIT_TOTAL?: string;
  SYMBOL_ALLOWLIST?: string;
  /** Contact for push services, e.g. "mailto:you@example.com" (required for background alerts). */
  VAPID_SUBJECT?: string;
}

export function intVar(value: string | undefined, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
