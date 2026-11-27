// HTTP routes for Sentia accounts and per-account cloud save.
//
//   POST /auth/signup                    { email, password, name?, linkBase? } → 201 { needsVerification, email, emailSent, resendAfter } (no session)
//   POST /auth/signin                    { email, password, remember? }        → { token, expiresAt, remember, account }
//                                                                                | 403 { needsVerification, email, emailSent, resendAfter } (unconfirmed email)
//   POST /auth/verify                    { email, code, remember? } | { token, remember? } → session like /auth/signin
//   POST /auth/verify/resend             { email, linkBase? }                  → { ok, resendAfter } (same answer for any address)
//   POST /auth/password/forgot           { email, linkBase? }                  → { ok, resendAfter } (same answer for any address)
//   POST /auth/password/check            { token }                             → { valid }
//   POST /auth/password/reset            { token, password } | { email, code, password } → { ok, email } (all old sessions end)
//   POST /auth/signout                   (Bearer)                              → { ok }
//   GET  /auth/me                        (Bearer)                              → { account, session }
//   POST /auth/delete                    (Bearer) { password }                 → deletes account + cloud save
//   POST /auth/passkey/register/options  (Bearer)                              → { challengeId, options }
//   POST /auth/passkey/register/verify   (Bearer) { challengeId, response, name? }
//   POST /auth/passkey/login/options                                           → { challengeId, options }
//   POST /auth/passkey/login/verify      { challengeId, response, remember? }  → session like /auth/signin
//   POST /auth/passkey/remove            (Bearer) { id }
//   GET  /auth/providers                                                       → { google, apple } (which "Continue with" buttons work)
//   POST /auth/oauth/nonce                                                     → { nonceId, nonce } (one-time, 10 min)
//   POST /auth/oauth/verify              { provider, idToken, nonceId, remember?, name? } → session like /auth/signin
//   GET  /account/state?known=<rev>      (Bearer)                              → { exists, revision, updatedAt, payload } | { unchanged }
//   POST /account/state                  (Bearer) { payload, baseRevision, force? } → { revision } | 409 { conflict }
//   GET  /account/backup                 (Bearer)                              → { exists, updatedAt, savedAt, payload }
//   POST /account/backup                 (Bearer) { payload, reason? }
//
// The site is a static export on another origin, so sessions are bearer tokens (no cookies).

import {
  authenticate,
  burnPasswordCheck,
  cleanName,
  clearFailedSignIns,
  createSession,
  createUser,
  deleteUserRecords,
  failedSignIns,
  findUserByEmail,
  getUser,
  hashPassword,
  isVerified,
  markVerified,
  endSession,
  MAX_FAILED_SIGNINS,
  normalizeEmail,
  providerKey,
  publicAccount,
  putEmailPointer,
  putUser,
  recordFailedSignIn,
  sha256Hex,
  validatePassword,
  verifyPassword,
  type UserRecord,
} from "./auth";
import { deleteAccountState, readBackup, readState, saveState, STATE_MAX_BYTES, validatePayload, writeBackup } from "./account-state";
import { errorJson, json, readJson } from "./http";
import { emailConfigured, passwordResetEmail, sendEmail, verificationEmail } from "./mailer";
import {
  challengeLink,
  checkCode,
  CHALLENGE_TTL_S,
  clearChallenge,
  consumeLinkToken,
  hasLiveChallenge,
  issueChallenge,
  normalizeCode,
  peekLinkToken,
  resolveLinkBase,
  RESEND_INTERVAL_S,
  takeSendSlot,
  validLinkToken,
  type CodeCheck,
} from "./email-verify";
import { authenticationOptions, registrationOptions, relyingPartyFor, removePasskey, verifyAuthentication, verifyRegistration } from "./passkeys";
import { ipBucket, kvCounter, MemoryRateLimiter } from "./ratelimit";
import { audiencesFor, emailVerified, issueNonce, providerEnabled, takeNonce, verifyIdToken, type OidcProvider } from "./oidc";
import type { Env } from "./env";

const authBurst = new MemoryRateLimiter(10, 60_000); // sign-in / sign-up / passkey sign-in, per IP
const accountBurst = new MemoryRateLimiter(60, 60_000); // signed-in housekeeping, per IP
const stateWrites = new MemoryRateLimiter(30, 60_000); // cloud saves, per account
const stateReads = new MemoryRateLimiter(60, 60_000); // cloud loads / polls, per account
const codeBurst = new MemoryRateLimiter(20, 60_000); // email codes, links, resends and resets, per IP
export const SIGNUPS_PER_IP_PER_DAY = 20;

const SIGNIN_FAILED = "Email or password is incorrect.";
const LOCKED = "Too many attempts. Please wait 15 minutes and try again.";
const NOT_SIGNED_IN = "You're signed out. Please sign in again.";
const EMAIL_OFF = "New accounts need email verification, which isn't set up on this server yet. Please try again later.";
const RESET_OFF = "Password reset by email isn't set up on this server yet. Contact support@sentiacoach.com for help.";
const BAD_CODE = "That code isn't right or has expired. Check the latest email, or send a new code.";
const BAD_LINK = "This link has expired or was already used. Send yourself a new one.";
const SEND_FAILED = "We couldn't send the email just now. Please try again in a minute.";
const EXPIRE_MIN = CHALLENGE_TTL_S / 60;

function codeError(result: Exclude<CodeCheck, { ok: true }>, cors: Record<string, string>) {
  if (result.reason === "invalid") {
    return json({ error: `That code isn't right. ${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left.`, triesLeft: result.triesLeft }, 400, cors);
  }
  if (result.reason === "locked") return json({ error: "Too many wrong codes. Send yourself a new code to try again.", mustResend: true }, 400, cors);
  return json({ error: BAD_CODE, mustResend: true }, 400, cors);
}

function sendLimited(retryAfter: number, daily: boolean, cors: Record<string, string>) {
  const error = daily ? "You've asked for the maximum number of emails today. Please try again tomorrow." : `Please wait ${retryAfter} seconds before asking for another email.`;
  return json({ error, retryAfter }, 429, { ...cors, "Retry-After": String(retryAfter) });
}

export function resetAccountLimiters() {
  for (const l of [authBurst, accountBurst, stateWrites, stateReads, codeBurst]) (l as unknown as { hits: Map<string, unknown> }).hits.clear();
}

type RouteArgs = { request: Request; env: Env; path: string; cors: Record<string, string>; ip: string; now: number; url: URL; f?: typeof fetch };
/** How recent a sign-in must be to delete an account that has no password (Google / Apple only). */
export const RECENT_SIGNIN_MS = 15 * 60 * 1000;

const noStore = (cors: Record<string, string>) => ({ ...cors, "Cache-Control": "no-store" });

function sessionResponse(user: UserRecord, session: { token: string; expiresAt: number }, remember: boolean, cors: Record<string, string>, status = 200) {
  return json({ token: session.token, expiresAt: session.expiresAt, remember, account: publicAccount(user) }, status, noStore(cors));
}

const rememberFlag = (body: Record<string, unknown> | null) => body?.remember === true;

/** Handles /auth/* and /account/*; returns null for any other path. */
export async function handleAccountRoute(args: RouteArgs): Promise<Response | null> {
  const { request, env, path, cors, ip, now, url } = args;
  const f = args.f ?? fetch;
  if (!path.startsWith("/auth/") && !path.startsWith("/account/")) return null;
  const kv = env.SENTIA_KV;
  if (!kv) return errorJson(503, "Accounts are not set up on this server.", cors);
  const method = request.method;
  const tooMany = (retry = 60) => errorJson(429, "Too many requests. Please wait a minute and try again.", { ...cors, "Retry-After": String(retry) });

  /** Issue a new verification challenge and email it. True when Resend accepted the email. */
  const sendVerification = async (user: UserRecord, linkBase: unknown): Promise<boolean> => {
    const { code, token } = await issueChallenge(kv, "verify", user.id, now);
    const link = challengeLink(resolveLinkBase(linkBase, env), "verify", token);
    return sendEmail(env, verificationEmail(user.email, code, link, EXPIRE_MIN), f);
  };

  /** "Check your email" answer for an unconfirmed account, sending a code first when asked (and allowed). */
  const verificationPending = async (user: UserRecord, linkBase: unknown, status: number, send: boolean): Promise<Response> => {
    let emailSent = false;
    let resendAfter = 0;
    if (send) {
      const slot = await takeSendSlot(kv, "verify", user.email, now);
      if (slot.ok) {
        emailSent = await sendVerification(user, linkBase);
        resendAfter = RESEND_INTERVAL_S;
      } else {
        resendAfter = slot.retryAfter;
      }
    }
    const error = status === 403 ? "Please confirm your email first. We sent you a 6-digit code." : undefined;
    return json(
      { needsVerification: true, email: user.email, emailSent, resendAfter, ...(error ? { error } : {}), ...(send && !emailSent && resendAfter === RESEND_INTERVAL_S ? { sendError: SEND_FAILED } : {}) },
      status,
      noStore(cors),
    );
  };

  // ---- public (no session) -------------------------------------------------------
  if (path === "/auth/signup" && method === "POST") {
    if (!authBurst.check(ip, now).ok) return tooMany();
    // No email service = no way to confirm addresses, so no new email accounts (never a bypass).
    if (!emailConfigured(env)) return errorJson(503, EMAIL_OFF, cors);
    const body = (await readJson(request, 4000)) as Record<string, unknown> | null;
    const email = normalizeEmail(body?.email);
    if (!email) return errorJson(400, "Enter a valid email address.", cors);
    const pw = validatePassword(body?.password, email);
    if (!pw.ok) return errorJson(400, pw.error, cors);
    const duplicate = errorJson(409, "We couldn't create an account with those details. If you already have one, sign in instead.", cors);
    const existing = await findUserByEmail(kv, email, now);
    if (existing) {
      // The same person signing up again before confirming (same password): just send the email again.
      if (!isVerified(existing) && existing.password && (await verifyPassword(pw.password, existing.password))) {
        return verificationPending(existing, body?.linkBase, 201, true);
      }
      return duplicate;
    }
    const daily = await kvCounter(kv, await ipBucket(ip, "signup", now), SIGNUPS_PER_IP_PER_DAY, 86_400);
    if (!daily.ok) return errorJson(429, "Too many new accounts from this network today. Try again tomorrow.", cors);
    const user = await createUser(kv, { email, password: pw.password, name: cleanName(body?.name), unverified: true }, now);
    // Same wording whether the email is taken or something else failed.
    if (!user) return duplicate;
    return verificationPending(user, body?.linkBase, 201, true);
  }

  if (path === "/auth/signin" && method === "POST") {
    if (!authBurst.check(ip, now).ok) return tooMany();
    const body = (await readJson(request, 4000)) as Record<string, unknown> | null;
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" && body.password.length <= 256 ? body.password : "";
    if (!email || !password) return errorJson(401, SIGNIN_FAILED, cors);
    const failures = await failedSignIns(kv, email);
    if (failures >= MAX_FAILED_SIGNINS) return errorJson(429, LOCKED, cors);
    const user = await findUserByEmail(kv, email, now);
    const ok = user?.password ? await verifyPassword(password, user.password) : (await burnPasswordCheck(password), false);
    if (!ok || !user) {
      await recordFailedSignIn(kv, email);
      return errorJson(401, SIGNIN_FAILED, cors);
    }
    if (failures > 0) await clearFailedSignIns(kv, email);
    if (!isVerified(user)) {
      // Right password, unconfirmed email: no session. Send a fresh code only if none is still live.
      const live = await hasLiveChallenge(kv, "verify", user.id, now);
      return verificationPending(user, body?.linkBase, 403, !live);
    }
    const remember = rememberFlag(body);
    return sessionResponse(user, await createSession(kv, user.id, remember, now), remember, cors);
  }

  if (path === "/auth/verify" && method === "POST") {
    if (!codeBurst.check(ip, now).ok) return tooMany();
    const body = (await readJson(request, 2000)) as Record<string, unknown> | null;
    const remember = rememberFlag(body);
    let user: UserRecord | null = null;
    if (body?.token !== undefined) {
      const uid = validLinkToken(body.token) ? await consumeLinkToken(kv, "verify", body.token, now) : null;
      user = uid ? await getUser(kv, uid) : null;
      if (!user) return json({ error: BAD_LINK, linkInvalid: true }, 400, cors);
    } else {
      const email = normalizeEmail(body?.email);
      const code = normalizeCode(body?.code);
      if (!email || !code) return errorJson(400, "Enter the 6-digit code from the email.", cors);
      user = await findUserByEmail(kv, email, now);
      if (!user || isVerified(user)) return json({ error: BAD_CODE, mustResend: true }, 400, cors);
      const result = await checkCode(kv, "verify", user.id, code, now);
      if (!result.ok) return codeError(result, cors);
    }
    if (!isVerified(user)) await markVerified(kv, user);
    return sessionResponse(user, await createSession(kv, user.id, remember, now), remember, cors);
  }

  if (path === "/auth/verify/resend" && method === "POST") {
    if (!codeBurst.check(ip, now).ok) return tooMany();
    if (!emailConfigured(env)) return errorJson(503, EMAIL_OFF, cors);
    const body = (await readJson(request, 2000)) as Record<string, unknown> | null;
    const email = normalizeEmail(body?.email);
    if (!email) return errorJson(400, "Enter a valid email address.", cors);
    // The throttle is keyed by the address, so unknown and known emails answer the same way.
    const slot = await takeSendSlot(kv, "verify", email, now);
    if (!slot.ok) return sendLimited(slot.retryAfter, slot.daily, cors);
    const user = await findUserByEmail(kv, email, now);
    if (user && !isVerified(user)) {
      const sent = await sendVerification(user, body?.linkBase);
      if (!sent) return errorJson(502, SEND_FAILED, cors);
    }
    return json({ ok: true, resendAfter: RESEND_INTERVAL_S }, 200, noStore(cors));
  }

  if (path === "/auth/password/forgot" && method === "POST") {
    if (!codeBurst.check(ip, now).ok) return tooMany();
    if (!emailConfigured(env)) return errorJson(503, RESET_OFF, cors);
    const body = (await readJson(request, 2000)) as Record<string, unknown> | null;
    const email = normalizeEmail(body?.email);
    if (!email) return errorJson(400, "Enter a valid email address.", cors);
    const slot = await takeSendSlot(kv, "reset", email, now);
    if (!slot.ok) return sendLimited(slot.retryAfter, slot.daily, cors);
    const user = await findUserByEmail(kv, email, now);
    if (user && !user.email.endsWith(".invalid")) {
      const { code, token } = await issueChallenge(kv, "reset", user.id, now);
      const link = challengeLink(resolveLinkBase(body?.linkBase, env), "reset", token);
      // Same answer whether or not the send worked, so the reply never says if the account exists.
      await sendEmail(env, passwordResetEmail(user.email, code, link, EXPIRE_MIN), f);
    }
    return json({ ok: true, resendAfter: RESEND_INTERVAL_S }, 200, noStore(cors));
  }

  if (path === "/auth/password/check" && method === "POST") {
    if (!codeBurst.check(ip, now).ok) return tooMany();
    const body = (await readJson(request, 1000)) as Record<string, unknown> | null;
    const uid = validLinkToken(body?.token) ? await peekLinkToken(kv, "reset", body.token, now) : null;
    return json({ valid: Boolean(uid && (await getUser(kv, uid))) }, 200, noStore(cors));
  }

  if (path === "/auth/password/reset" && method === "POST") {
    if (!codeBurst.check(ip, now).ok) return tooMany();
    const body = (await readJson(request, 2000)) as Record<string, unknown> | null;
    let user: UserRecord | null = null;
    const byLink = body?.token !== undefined;
    if (byLink) {
      const uid = validLinkToken(body.token) ? await peekLinkToken(kv, "reset", body.token, now) : null;
      user = uid ? await getUser(kv, uid) : null;
      if (!user) return json({ error: BAD_LINK, linkInvalid: true }, 400, cors);
    } else {
      const email = normalizeEmail(body?.email);
      if (!email || !normalizeCode(body?.code)) return errorJson(400, "Enter the 6-digit code from the email.", cors);
      user = await findUserByEmail(kv, email, now);
      if (!user) return json({ error: BAD_CODE, mustResend: true }, 400, cors);
    }
    // Check the new password before using up the code or link, so a typo doesn't cost a try.
    const pw = validatePassword(body?.password, user.email);
    if (!pw.ok) return errorJson(400, pw.error, cors);
    if (byLink) {
      if (!(await consumeLinkToken(kv, "reset", body.token as string, now))) return json({ error: BAD_LINK, linkInvalid: true }, 400, cors);
    } else {
      const result = await checkCode(kv, "reset", user.id, normalizeCode(body?.code) as string, now);
      if (!result.ok) return codeError(result, cors);
    }
    user.password = await hashPassword(pw.password);
    // Every older session (on any device) stops working.
    user.sessionsValidAfter = now;
    // Getting the email proves the address, so a pending sign-up is confirmed too.
    await markVerified(kv, user);
    await clearChallenge(kv, "verify", user.id);
    await clearFailedSignIns(kv, user.email);
    return json({ ok: true, email: user.email }, 200, noStore(cors));
  }

  if (path === "/auth/providers" && method === "GET") {
    return json({ google: providerEnabled("google", env), apple: providerEnabled("apple", env) }, 200, noStore(cors));
  }

  if (path === "/auth/oauth/nonce" && method === "POST") {
    if (!authBurst.check(ip, now).ok) return tooMany();
    return json(await issueNonce(kv), 200, noStore(cors));
  }

  if (path === "/auth/oauth/verify" && method === "POST") {
    if (!authBurst.check(ip, now).ok) return tooMany();
    const body = (await readJson(request, 12_000)) as Record<string, unknown> | null;
    const provider = body?.provider === "google" || body?.provider === "apple" ? (body.provider as OidcProvider) : null;
    if (!provider || !providerEnabled(provider, env)) return errorJson(400, "That sign-in option isn't available.", cors);
    const failed = errorJson(401, "We couldn't confirm that sign-in. Please try again.", cors);
    const nonce = await takeNonce(kv, body?.nonceId);
    if (!nonce) return failed;
    let claims;
    try {
      claims = await verifyIdToken(provider, body?.idToken, { audiences: audiencesFor(provider, env), nonce, f, now });
    } catch {
      return errorJson(503, "Sign-in is temporarily unavailable. Please try again shortly.", cors);
    }
    if (!claims) return failed;
    const remember = rememberFlag(body);
    const linkedId = await kv.get(providerKey(provider, claims.sub));
    const linked = linkedId ? await getUser(kv, linkedId) : null;
    if (linked) return sessionResponse(linked, await createSession(kv, linked.id, remember, now), remember, cors);

    // Only an address the provider has verified is used as the account email; otherwise the
    // account gets a private placeholder address (the provider sign-in itself is the proof of identity).
    const verifiedEmail = emailVerified(claims) ? normalizeEmail(claims.email) : null;
    const email = verifiedEmail ?? `${provider}-${(await sha256Hex(claims.sub)).slice(0, 16)}@users.sentia.invalid`;
    const existing = await findUserByEmail(kv, email, now);
    if (existing) {
      // Link only when the provider vouches for the address; otherwise anyone could claim it.
      if (!verifiedEmail || existing.providers?.[provider]) {
        return errorJson(409, "An account already uses this email. Sign in with your email and password instead.", cors);
      }
      if (!isVerified(existing)) {
        // An unconfirmed email sign-up for this address: the provider has now proven who owns it, so
        // the owner takes the account over and the unconfirmed password is dropped (stops "pre-hijacking").
        delete existing.password;
        existing.passkeys = [];
        await clearChallenge(kv, "verify", existing.id);
        delete existing.emailVerified;
      }
      existing.providers = { ...(existing.providers ?? {}), [provider]: claims.sub };
      await putUser(kv, existing);
      await putEmailPointer(kv, existing);
      await kv.put(providerKey(provider, claims.sub), existing.id);
      return sessionResponse(existing, await createSession(kv, existing.id, remember, now), remember, cors);
    }
    const daily = await kvCounter(kv, await ipBucket(ip, "signup", now), SIGNUPS_PER_IP_PER_DAY, 86_400);
    if (!daily.ok) return errorJson(429, "Too many new accounts from this network today. Try again tomorrow.", cors);
    // Google puts the name in the token; Apple only sends it to the browser on the very first sign-in.
    const name = cleanName(claims.name) || cleanName(body?.name);
    const user = await createUser(kv, { email, name, provider: { name: provider, sub: claims.sub } }, now);
    if (!user) return failed;
    return sessionResponse(user, await createSession(kv, user.id, remember, now), remember, cors, 201);
  }

  if (path === "/auth/passkey/login/options" && method === "POST") {
    if (!authBurst.check(ip, now).ok) return tooMany();
    const rp = relyingPartyFor(request.headers.get("Origin"), env);
    if (!rp) return errorJson(400, "Face ID / Touch ID sign-in isn't available here.", cors);
    return json(await authenticationOptions(kv, rp), 200, noStore(cors));
  }

  if (path === "/auth/passkey/login/verify" && method === "POST") {
    if (!authBurst.check(ip, now).ok) return tooMany();
    const rp = relyingPartyFor(request.headers.get("Origin"), env);
    if (!rp) return errorJson(400, "Face ID / Touch ID sign-in isn't available here.", cors);
    const body = (await readJson(request, 20_000)) as Record<string, unknown> | null;
    const found = body ? await verifyAuthentication(kv, rp, body, now) : null;
    const user = found && isVerified(found) ? found : null;
    if (!user) return errorJson(401, "That didn't work. Try again, or sign in with your password.", cors);
    const remember = rememberFlag(body);
    return sessionResponse(user, await createSession(kv, user.id, remember, now), remember, cors);
  }

  // ---- everything below needs a session ---------------------------------------------
  const auth = await authenticate(request, env, now);
  if (!auth) return errorJson(401, NOT_SIGNED_IN, cors);
  const { user, token, session } = auth;

  if (path.startsWith("/account/state") || path.startsWith("/account/backup")) {
    const limiter = method === "GET" ? stateReads : stateWrites;
    if (!limiter.check(user.id, now).ok) return tooMany(30);
  } else if (!accountBurst.check(ip, now).ok) {
    return tooMany();
  }

  if (path === "/auth/me" && method === "GET") {
    return json({ account: publicAccount(user), session: { expiresAt: session.exp, remember: session.remember } }, 200, noStore(cors));
  }

  if (path === "/auth/signout" && method === "POST") {
    await endSession(kv, token);
    return json({ ok: true }, 200, cors);
  }

  if (path === "/auth/delete" && method === "POST") {
    const body = (await readJson(request, 1000)) as Record<string, unknown> | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (user.password) {
      if (!password || !(await verifyPassword(password, user.password))) return errorJson(401, "That password isn't right.", cors);
    } else if (now - session.createdAt > RECENT_SIGNIN_MS) {
      return errorJson(401, "For your security, sign out and sign in again, then delete your account within 15 minutes.", cors);
    }
    await deleteAccountState(kv, user.id);
    await deleteUserRecords(kv, user, token);
    return json({ ok: true }, 200, cors);
  }

  if (path === "/auth/passkey/register/options" && method === "POST") {
    const rp = relyingPartyFor(request.headers.get("Origin"), env);
    if (!rp) return errorJson(400, "Face ID / Touch ID isn't available here.", cors);
    return json(await registrationOptions(kv, user, rp), 200, noStore(cors));
  }

  if (path === "/auth/passkey/register/verify" && method === "POST") {
    const rp = relyingPartyFor(request.headers.get("Origin"), env);
    if (!rp) return errorJson(400, "Face ID / Touch ID isn't available here.", cors);
    const body = (await readJson(request, 20_000)) as Record<string, unknown> | null;
    const result = await verifyRegistration(kv, user, rp, body ?? {}, now);
    if (!result.ok) return errorJson(400, result.error, cors);
    return json({ ok: true, account: publicAccount(user) }, 200, noStore(cors));
  }

  if (path === "/auth/passkey/remove" && method === "POST") {
    const body = (await readJson(request, 2000)) as Record<string, unknown> | null;
    if (!(await removePasskey(kv, user, body?.id))) return errorJson(404, "That passkey wasn't found.", cors);
    return json({ ok: true, account: publicAccount(user) }, 200, noStore(cors));
  }

  if (path === "/account/state" && method === "GET") {
    const record = await readState(kv, user.id);
    if (!record) return json({ exists: false, revision: 0 }, 200, noStore(cors));
    const known = Number.parseInt(url.searchParams.get("known") ?? "", 10);
    if (known === record.revision) return json({ exists: true, unchanged: true, revision: record.revision, updatedAt: record.updatedAt }, 200, noStore(cors));
    return json({ exists: true, revision: record.revision, updatedAt: record.updatedAt, savedAt: record.savedAt, payload: record.payload }, 200, noStore(cors));
  }

  if (path === "/account/state" && method === "POST") {
    const body = (await readJson(request, STATE_MAX_BYTES + 2000)) as Record<string, unknown> | null;
    if (!body) return errorJson(413, "Your saved data is too large to sync (max 1 MB).", cors);
    const payload = validatePayload(body.payload);
    if (!payload) return errorJson(400, "Invalid save data.", cors);
    const base = typeof body.baseRevision === "number" && Number.isInteger(body.baseRevision) && body.baseRevision >= 0 ? body.baseRevision : -1;
    if (base < 0) return errorJson(400, "Invalid save data.", cors);
    const result = await saveState(kv, user.id, payload, base, body.force === true, now);
    if (!result.ok) {
      const c = result.conflict;
      return json({ error: "A newer copy was saved from another device.", conflict: { revision: c.revision, updatedAt: c.updatedAt, savedAt: c.savedAt, payload: c.payload } }, 409, noStore(cors));
    }
    return json({ ok: true, revision: result.revision, savedAt: result.savedAt }, 200, noStore(cors));
  }

  if (path === "/account/backup" && method === "GET") {
    const record = await readBackup(kv, user.id);
    if (!record) return json({ exists: false }, 200, noStore(cors));
    return json({ exists: true, ...record }, 200, noStore(cors));
  }

  if (path === "/account/backup" && method === "POST") {
    const body = (await readJson(request, STATE_MAX_BYTES + 2000)) as Record<string, unknown> | null;
    if (!body) return errorJson(413, "Your saved data is too large to sync (max 1 MB).", cors);
    const payload = validatePayload(body.payload);
    if (!payload) return errorJson(400, "Invalid save data.", cors);
    const reason = typeof body.reason === "string" ? body.reason.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "other-device" : "other-device";
    const record = await writeBackup(kv, user.id, payload, reason, now);
    return json({ ok: true, updatedAt: record.updatedAt, savedAt: record.savedAt }, 200, noStore(cors));
  }

  return errorJson(404, "Not found.", cors);
}
