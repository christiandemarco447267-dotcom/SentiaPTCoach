"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BENCHMARK_SYMBOL, DEMO_UNIVERSE, demoSnapshot } from "./market";
import { apiConfigured, probeSentiaCoachApi, usingSentiaCoachApi } from "./api-config";
import { track } from "./analytics";
import { feedChangeNotice, type Feed } from "./feed-notice";
import { fetchLiveQuotes, type WorkerMarketState } from "./live-quotes";
import { snapshotFeed } from "./benchmark";
import * as alertOps from "./alerts";
import * as orderOps from "./orders";
import * as replayOps from "./time-machine";
import * as stressOps from "./stress-test";
import * as challengeOps from "./challenges";
import { upsertReport } from "./report-card";
import { showSystemNotification } from "./notify";
import { assetPath } from "./asset";
import { celebrate } from "./celebrate";
import { formatCurrency, formatNumber, formatPercent } from "./format";
import { processMarketTick, type TickResult } from "./market-tick";
import { portfolioSymbols, summarizePortfolio, type PortfolioSummary } from "./portfolio";
import * as mutations from "./storage";
import { createInitialState, LEGACY_STORAGE_KEYS, loadStateFromString, parseStoredState, serializeState, STORAGE_KEY, UNREADABLE_BACKUP_KEY } from "./storage";
import {
  AppStateSchema,
  type AppState,
  type MarketSnapshot,
  type MarketStatus,
  type Mood,
  type PriceAlert,
  type Quote,
  type ReplayResult,
  type Settings,
  type TradePlan,
  type WeeklyReport,
} from "./types";
import { friendlyAuthError } from "./auth-helpers";
import { AUTOSAVE_DEBOUNCE_MS, createDebouncedSaver, isRemoteNewer, type DebouncedSaver } from "./cloud-sync";
// Firestore sync loads on demand (signed-in accounts only), keeping the SDK off the guest path.
const loadCloudStore = () => import("./cloud-store");
import { normalizeSymbol } from "./validation";
import { browserHistoryStorage, clearCoachHistory } from "./coach-history";
import {
  ACCOUNT_POLL_MS,
  ACCOUNT_RETRY_MS,
  ACCOUNT_SAVE_DEBOUNCE_MS,
  adoptRevision,
  applyExtras,
  clearPendingIfSaved,
  decideInitialState,
  fetchAccountState,
  pendingKey,
  pollAccountState,
  RemoteNewerError,
  resetRevision,
  saveAccountState,
  saveBackup,
  writePending,
} from "./account-sync";
import { AccountError, currentToken, getSessionSnapshot, isNetworkError } from "./sentia-accounts";

// ---- Market config ---------------------------------------------------------

// How often quotes auto-refresh (ms). The Sentia API caches ~15s during market hours.
const MARKET_REFRESH_MS = 15_000;
// Set on the static export build so we skip the (non-existent) /api route.
const IS_STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";

// ---- Module store (single source of truth, survives re-renders) ----------
//
// Two storage modes share one in-memory store:
//  - guest: local-first demo, persisted to localStorage on this device only.
//  - cloud: a signed-in account with a debounced autosave on every change, on one of two backends:
//      firebase → Firestore at users/{uid}/state/current, with live updates from other devices;
//      sentia   → the Sentia Worker (account-sync.ts), with revision checks, a device copy of
//                 unsaved changes, offline retry, and a periodic check for other devices' saves.

export type CloudBackend = "firebase" | "sentia";
export type StorageMode = { kind: "guest" } | { kind: "cloud"; uid: string; backend?: CloudBackend };
export type SyncStatus = "local" | "loading" | "saving" | "saved" | "offline" | "error";
export type SyncState = { mode: StorageMode["kind"] | null; status: SyncStatus; error?: string };

let mode: StorageMode | null = null;
let generation = 0;
let current: AppState | null = null;
let sync: SyncState = { mode: null, status: "local" };
let saver: DebouncedSaver<AppState> | null = null;
let unwatch: (() => void) | null = null;
// Set when the cloud copy exists but can't be read, so autosave never overwrites it.
let cloudWritesBlocked = false;
let storageListenerInstalled = false;
// Sentia-account sync state (see activateSentia).
let sentiaTimers: ReturnType<typeof setTimeout>[] = [];
let sentiaCleanup: (() => void)[] = [];
let carriedGuest = false;
let exiting = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AppState | null {
  return current;
}

function getServerSnapshot(): AppState | null {
  return null;
}

function getSyncSnapshot(): SyncState {
  return sync;
}

// ---- Toasts (order fills, price alerts) ------------------------------------

export type ToastTone = "gain" | "loss" | "info";
export type Toast = { id: number; title: string; body: string; tone: ToastTone; fx?: "badge" };
/** Also show this toast as a system (phone) notification when the user turned that on. */
type ToastNotify = { tag: string; url?: string };

let toasts: Toast[] = [];
let toastSeq = 0;
const TOAST_TTL_MS = 9_000;
const MAX_TOASTS = 4;
const NO_TOASTS: Toast[] = [];

function getToastsSnapshot(): Toast[] {
  return toasts;
}
function getServerToastsSnapshot(): Toast[] {
  return NO_TOASTS;
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function pushToast(toast: Omit<Toast, "id">, notify?: ToastNotify) {
  toastSeq += 1;
  const id = toastSeq;
  toasts = [...toasts, { ...toast, id }].slice(-MAX_TOASTS);
  emit();
  setTimeout(() => dismissToast(id), TOAST_TTL_MS);
  // Price alerts and order fills are mirrored to a system notification (via the
  // service worker) when the user switched that on in Settings and granted permission.
  if (notify && current?.settings.alertNotifications) {
    void showSystemNotification({ title: toast.title, body: toast.body, tag: notify.tag, url: notify.url });
  }
}

// ---- Celebrations -----------------------------------------------------------

/** Confetti + haptics (per settings) with a matching toast. */
export function celebrateNow(title: string, body: string, fx?: Toast["fx"]) {
  if (!current) return;
  pushToast({ title, body, tone: "gain", ...(fx ? { fx } : {}) });
  celebrate(current.settings);
}

/** A profitable close of a position that was linked to a thesis deserves a moment. */
function celebrateThesisWins(prev: AppState, next: AppState) {
  if (next.transactions === prev.transactions) return;
  const seen = new Set(prev.transactions.map((t) => t.id));
  for (const tx of next.transactions) {
    if (seen.has(tx.id) || tx.type !== "sell" || !tx.thesisId || !((tx.realizedGain ?? 0) > 0)) continue;
    const thesis = next.theses.find((t) => t.id === tx.thesisId);
    celebrateNow("Thesis paid off", `${tx.symbol} closed for a ${formatCurrency(tx.realizedGain ?? 0)} gain${thesis ? ` — “${thesis.title}”` : ""}.`);
    break;
  }
}

function alertText(alert: PriceAlert): string {
  return `${alert.symbol} ${alert.direction === "above" ? "rose above" : "fell below"} ${formatCurrency(alert.price)}`;
}

function announceTick(result: TickResult) {
  for (const fill of result.fills) {
    const { order } = fill;
    const what = `${orderOps.orderLabel(order)} · ${formatNumber(order.shares)} ${order.symbol}`;
    const notify = { tag: `order-${order.id}`, url: assetPath("/app/trade/") };
    if (fill.kind === "filled") {
      pushToast({ title: "Order filled", body: `${what} filled at ${formatCurrency(fill.price)}.`, tone: "gain" }, notify);
    } else {
      pushToast({ title: "Order rejected", body: `${what}: ${fill.reason}`, tone: "loss" }, notify);
    }
  }
  for (const { alert, price } of result.alerts) {
    pushToast(
      { title: "Price alert", body: `${alertText(alert)} (now ${formatCurrency(price)}).`, tone: "info" },
      { tag: `alert-${alert.id}`, url: assetPath(`/app/trade/?symbol=${encodeURIComponent(alert.symbol)}`) },
    );
  }
}

/** Toast + confetti for a newly recorded badge. */
export function announceBadge(id: string) {
  const def = challengeOps.challengeForBadge(id);
  if (!def) return;
  celebrateNow(`Badge earned: ${def.badge}`, `${def.title}. See it on the Challenges page.`, "badge");
}

/** Run the fill engine, alerts and snapshotting against the newest quotes. */
function applyMarketTick(quotes: Quote[]) {
  if (!current || quotes.length === 0) return;
  const now = Date.now();
  const result = processMarketTick(current, quotes, now);
  // "Hold through a dip" challenge tracking rides on the same price update.
  const dips = challengeOps.trackDips(result.changed ? result.state : current, quotes, now);
  if (!result.changed && dips.state === current) return;
  const parsed = AppStateSchema.safeParse(dips.state);
  if (!parsed.success) return; // never persist an invalid state; try again next tick
  const prev = current;
  setCurrent(parsed.data);
  if (result.changed) announceTick(result);
  if (dips.earned) announceBadge("hold-dip");
  celebrateThesisWins(prev, parsed.data);
}

const SERVER_SYNC: SyncState = { mode: null, status: "local" };
function getServerSyncSnapshot(): SyncState {
  return SERVER_SYNC;
}

function setSync(next: Omit<SyncState, "mode">) {
  sync = { mode: mode?.kind ?? null, ...next };
  emit();
}

function persistLocal(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch {
    // Storage may be unavailable (private mode / quota). State still works in-memory.
  }
}

function persist(state: AppState) {
  if (mode?.kind === "cloud") {
    if (cloudWritesBlocked) return;
    // Keep this account's latest change on the device until the cloud has it (offline, tab closed).
    if (mode.backend === "sentia") writePending(accountStorage(), mode.uid, state);
    saver?.schedule(state);
    return;
  }
  persistLocal(state);
}

function setCurrent(next: AppState) {
  current = next;
  persist(next);
  emit();
}

function readStoredRaw(): string | null {
  // Reading storage can throw (e.g. cookies/site data blocked); treat that as "no saved data".
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return raw;
    // Fall back to a pre-rebrand key so existing data carries over.
    for (const key of LEGACY_STORAGE_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return legacy;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Load the guest workspace. Saved data this version can't read (corrupt, or
 * written by a newer Sentia in another tab) is copied to a backup key before the
 * fresh demo replaces it, so it is never silently destroyed.
 */
function loadGuestState(raw: string | null): AppState {
  if (!raw) return createInitialState();
  const parsed = parseStoredState(raw);
  if (parsed) return parsed;
  try {
    localStorage.setItem(UNREADABLE_BACKUP_KEY, raw);
  } catch {
    // Quota/private mode: nothing more we can do.
  }
  pushToast({
    title: "Saved data couldn't be read",
    body: "Sentia started a fresh demo workspace. Your previous data was kept as a backup on this device.",
    tone: "loss",
  });
  return createInitialState();
}

function installStorageListener() {
  if (storageListenerInstalled) return;
  storageListenerInstalled = true;
  // Cross-tab sync for guest mode (cloud mode syncs through Firestore instead).
  window.addEventListener("storage", (event) => {
    if (mode?.kind === "guest" && event.key === STORAGE_KEY) {
      // A cleared key (another tab reset storage) starts fresh; unreadable data is backed up, not wiped.
      current = event.newValue === null ? createInitialState() : loadGuestState(event.newValue);
      emit();
    }
  });
}

function teardownCloud() {
  unwatch?.();
  unwatch = null;
  saver?.cancel();
  saver = null;
  cloudWritesBlocked = false;
  for (const t of sentiaTimers) clearTimeout(t);
  sentiaTimers = [];
  for (const fn of sentiaCleanup) fn();
  sentiaCleanup = [];
  carriedGuest = false;
}

function sameMode(a: StorageMode | null, b: StorageMode): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "guest" || (b.kind === "cloud" && a.uid === b.uid && (a.backend ?? "firebase") === (b.backend ?? "firebase"));
}

/** Where a Sentia account's device copy lives: localStorage with "Remember me", else this tab only. */
function accountStorage(): Storage | null {
  try {
    return getSessionSnapshot().session?.remember ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function browserLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Run `fn` once when the device is back online (cleaned up on mode change). */
function whenOnline(gen: number, fn: () => void) {
  const handler = () => {
    window.removeEventListener("online", handler);
    if (gen === generation) fn();
  };
  window.addEventListener("online", handler);
  sentiaCleanup.push(() => window.removeEventListener("online", handler));
}

/**
 * A Sentia (Worker) account: load the saved progress (merging this device's guest workspace or
 * unsaved changes, newest wins, the other copy backed up), then autosave every change.
 */
function activateSentia(uid: string, gen: number) {
  const store = accountStorage();
  let lastSaved: AppState | null = null;
  saver = createDebouncedSaver<AppState>(
    async (state) => {
      await saveAccountState(state, uid, currentToken(), browserLocal(), { keepalive: exiting });
      lastSaved = state;
    },
    ACCOUNT_SAVE_DEBOUNCE_MS,
    {
      onStart: () => gen === generation && setSync({ status: online() ? "saving" : "offline" }),
      onSuccess: () => {
        if (gen !== generation) return;
        if (lastSaved) clearPendingIfSaved(store, uid, lastSaved);
        if (carriedGuest) {
          // The demo workspace now lives in the account: take it off the device so signing out
          // later doesn't leave the account's data behind as "guest" data.
          carriedGuest = false;
          try {
            localStorage.removeItem(STORAGE_KEY);
            for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
          } catch {
            // ignore
          }
        }
        if (!saver?.pending()) setSync({ status: "saved" });
      },
      onError: (error) => {
        if (gen !== generation) return;
        if (error instanceof RemoteNewerError) {
          current = error.remote;
          try {
            store?.removeItem(pendingKey(uid));
          } catch {
            // ignore
          }
          setSync({ status: "saved" });
          pushToast({ title: "Updated from another device", body: "Newer progress was saved on another device, so it's shown here. This device's copy is kept as a backup in Settings.", tone: "info" });
          return;
        }
        if (isNetworkError(error) || !online()) {
          setSync({ status: "offline" });
          whenOnline(gen, () => {
            if (current && !cloudWritesBlocked) {
              saver?.schedule(current);
              void saver?.flush();
            }
          });
          return;
        }
        if (error instanceof AccountError && error.status === 401) {
          setSync({ status: "error", error: "You've been signed out, so changes aren't being saved to your account. Sign in again; your latest changes are kept on this device." });
          return;
        }
        setSync({ status: "error", error: error instanceof Error ? error.message : "Couldn't save to your account. We'll try again shortly." });
        sentiaTimers.push(
          setTimeout(() => {
            if (gen === generation && current && !cloudWritesBlocked) saver?.schedule(current);
          }, ACCOUNT_RETRY_MS),
        );
      },
    },
  );

  const startPolling = () => {
    const check = () => {
      if (gen !== generation || saver?.pending() || cloudWritesBlocked || !online() || document.visibilityState !== "visible") return;
      void pollAccountState(uid, currentToken())
        .then((remote) => {
          if (gen !== generation || !remote?.state || saver?.pending()) return;
          if (isRemoteNewer(remote.state, current)) {
            adoptRevision(uid, remote.revision);
            applyExtras(remote.payload, uid, browserLocal());
            current = remote.state;
            emit();
          }
        })
        .catch(() => undefined);
    };
    const interval = setInterval(check, ACCOUNT_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    sentiaCleanup.push(() => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    });
  };

  resetRevision(uid);
  fetchAccountState(uid, currentToken())
    .then((remote) => {
      if (gen !== generation) return;
      if (remote.unreadable) {
        cloudWritesBlocked = true;
        current = createInitialState();
        setSync({ status: "error", error: "Your saved progress was written by a newer version of Sentia, so changes here won't be saved. Reload the page to update." });
        return;
      }
      applyExtras(remote.payload, uid, browserLocal());
      const guestRaw = readStoredRaw();
      const decision = decideInitialState({
        cloud: remote.state,
        pending: readPendingState(store, uid),
        guest: guestRaw ? parseStoredState(guestRaw) : null,
        fresh: createInitialState,
      });
      current = decision.state;
      carriedGuest = decision.carriedGuest;
      if (decision.backup) {
        void saveBackup(decision.backup, uid, currentToken(), decision.source === "guest" ? "replaced-by-device" : "older-copy", browserLocal()).catch(() => undefined);
      }
      if (decision.source === "guest" && remote.state) {
        pushToast({ title: "Your latest progress is saved to your account", body: "This device had newer practice progress, so it's now your account's. The previous account copy is kept as a backup in Settings.", tone: "info" });
      }
      if (decision.push && current) {
        writePending(store, uid, current);
        setSync({ status: "saving" });
        saver?.schedule(current);
        void saver?.flush();
      } else {
        setSync({ status: "saved" });
      }
      startPolling();
    })
    .catch((error: unknown) => {
      if (gen !== generation) return;
      if (isNetworkError(error) || !online()) {
        // Offline start: carry on from this account's device copy if there is one; sync when back.
        const pending = readPendingState(store, uid);
        if (pending) {
          current = pending;
          setSync({ status: "offline" });
        } else {
          setSync({ status: "error", error: "You're offline, so your account can't load yet. It will load automatically when you're back online." });
        }
        whenOnline(gen, () => activate({ kind: "cloud", uid, backend: "sentia" }, true));
        return;
      }
      setSync({ status: "error", error: error instanceof Error ? error.message : "Couldn't load your account." });
    });
}

function readPendingState(store: Storage | null, uid: string): AppState | null {
  try {
    const raw = store?.getItem(pendingKey(uid));
    return raw ? parseStoredState(raw) : null;
  } catch {
    return null;
  }
}

/** Switch the store to guest (localStorage) or a signed-in account (Firestore). */
function activate(next: StorageMode, force = false) {
  if (!force && sameMode(mode, next)) return;
  teardownCloud();
  generation += 1;
  const gen = generation;
  mode = next;

  if (next.kind === "guest") {
    current = loadGuestState(readStoredRaw());
    persistLocal(current); // normalize/migrate on disk (under the new key)
    installStorageListener();
    setSync({ status: "local" });
    return;
  }

  const { uid } = next;
  current = null;
  setSync({ status: "loading" });
  if (next.backend === "sentia") {
    activateSentia(uid, gen);
    return;
  }
  saver = createDebouncedSaver<AppState>((state) => loadCloudStore().then((m) => m.saveCloudState(uid, state)), AUTOSAVE_DEBOUNCE_MS, {
    onStart: () => gen === generation && setSync({ status: "saving" }),
    onSuccess: () => gen === generation && !saver?.pending() && setSync({ status: "saved" }),
    onError: (error) => gen === generation && setSync({ status: "error", error: friendlyAuthError(error, "Couldn't save to the cloud. Your latest changes are kept in this tab; we'll retry on the next change.") }),
  });

  loadCloudStore()
    .then(async (cloud) => ({ cloud, ...(await cloud.loadCloudState(uid)) }))
    .then(({ cloud, exists, state }) => {
      if (gen !== generation) return;
      if (exists && !state) {
        // Never overwrite cloud data we can't read (e.g. written by a newer app version).
        cloudWritesBlocked = true;
        current = createInitialState();
        setSync({ status: "error", error: "Your saved account data couldn't be read by this version of Sentia, so changes here won't be saved. Try reloading." });
        return;
      }
      if (state) {
        current = state;
        setSync({ status: "saved" });
      } else {
        // First sign-in: start from this device's guest workspace (if any) so nothing is lost.
        const local = readStoredRaw();
        const seeded = local ? loadStateFromString(local) : createInitialState();
        current = seeded;
        setSync({ status: "saving" });
        saver?.schedule(seeded);
        void saver?.flush();
      }
      unwatch = cloud.watchCloudState(
        uid,
        (remote) => {
          if (gen !== generation || saver?.pending()) return;
          if (isRemoteNewer(remote, current)) {
            current = remote;
            emit();
          }
        },
        (error) => gen === generation && setSync({ status: "error", error: friendlyAuthError(error) }),
      );
    })
    .catch((error) => {
      if (gen !== generation) return;
      setSync({ status: "error", error: friendlyAuthError(error, "Couldn't load your account from the cloud.") });
    });
}

/** Retry loading the signed-in account after an error. */
export function retryCloudLoad() {
  if (mode) activate(mode, true);
}

/** Write any pending cloud change now (call before sign-out). `onExit` uses a keepalive request so it survives the page closing. */
export async function flushCloudSave(opts: { onExit?: boolean } = {}): Promise<void> {
  exiting = Boolean(opts.onExit);
  try {
    await saver?.flush();
  } finally {
    exiting = false;
  }
}

/** True while a change hasn't reached the signed-in account yet (offline, saving, or failed). */
export function hasUnsavedAccountChanges(): boolean {
  if (mode?.kind !== "cloud") return false;
  return Boolean(saver?.pending()) || sync.status === "offline" || sync.status === "error";
}

/** Ask for a save of the current state (e.g. after the coach conversation, which lives outside AppState, changed). */
export function requestAccountSave(): void {
  if (mode?.kind === "cloud" && mode.backend === "sentia" && current && !cloudWritesBlocked) saver?.schedule(current);
}

/**
 * Swap in the account's backup copy (Sentia accounts). The copy shown now becomes the backup,
 * so the swap can be undone the same way.
 */
export async function restoreAccountBackup(backup: AppState): Promise<void> {
  if (mode?.kind !== "cloud" || mode.backend !== "sentia" || !current) throw new Error("Sign in to restore a backup.");
  await saveBackup(current, mode.uid, currentToken(), "swapped-out", browserLocal());
  setCurrent({ ...backup, updatedAt: new Date().toISOString() });
}

/** Drop the in-memory account (after sign-out) so nothing leaks to the next session. */
export function deactivateStore() {
  teardownCloud();
  generation += 1;
  mode = null;
  current = null;
  sync = { mode: null, status: "local" };
  emit();
}

/**
 * Apply a mutation. Throws (without persisting) if the mutation rejects the
 * action, and validates the result against the schema so a bug can never
 * persist out-of-range/corrupt state (which would otherwise wipe data on reload).
 */
function mutate(fn: (state: AppState) => AppState) {
  if (!current) throw new Error("Store not ready yet.");
  const next = fn(current);
  const parsed = AppStateSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error("That action was canceled because it would exceed allowed limits.");
  }
  const prev = current;
  setCurrent(parsed.data);
  celebrateThesisWins(prev, parsed.data);
}

/** Advance the Time Machine; records the result and celebrates beating SPY at the end. */
function stepReplay(by: number | "end"): ReplayResult | null {
  let finished: ReplayResult | null = null;
  mutate((s) => {
    const r = replayOps.stepReplay(s, by);
    finished = r.finished;
    return r.state;
  });
  const done = finished as ReplayResult | null;
  if (done) track("time_machine_finished");
  if (done && done.returnPct > done.spyReturnPct) {
    celebrateNow("You beat the S&P 500", `Replay return ${formatPercent(done.returnPct, false, 1)} vs SPY ${formatPercent(done.spyReturnPct, false, 1)}.`);
  }
  return done;
}

// ---- Market -------------------------------------------------------------

export type MarketState = {
  status: MarketStatus | "loading" | "error";
  quotes: Quote[];
  updatedAt?: string;
  error?: string;
  /** Where prices come from: real quotes ("live", which includes delayed ones) or simulated ("demo"). */
  feed?: Feed;
  /** Why the feed is demo: no live service configured, or the configured one is unreachable. */
  demoReason?: "not-configured" | "unreachable";
  /** Exchange session reported by the live service. */
  session?: WorkerMarketState;
  /** Symbols the live service couldn't price (shown without a price, never with a simulated one). */
  missing?: string[];
};

// What the user last saw, so a change of price source can be announced (module-level: survives re-renders).
let lastFeed: { feed: Feed; quotes: Quote[] } | null = null;

function announceFeed(next: MarketState) {
  if (!current || !next.feed) return;
  const prev = lastFeed
    ? { feed: lastFeed.feed, quotes: lastFeed.quotes }
    : (() => {
        // First load this session: compare against the newest saved snapshot, if any.
        const last = current.snapshots[current.snapshots.length - 1];
        return last ? { feed: snapshotFeed(last), total: last.value } : null;
      })();
  const notice = feedChangeNotice(current, prev, { feed: next.feed, quotes: next.quotes, reason: next.demoReason });
  lastFeed = { feed: next.feed, quotes: next.quotes };
  if (notice) pushToast(notice);
}

// ---- Context ------------------------------------------------------------

export type AppApi = {
  ready: boolean;
  state: AppState | null;
  summary: PortfolioSummary | null;
  market: MarketState;
  quotes: Quote[];
  /** Where the paper account lives (guest = this device; cloud = the signed-in account) and save status. */
  sync: SyncState;
  tourOpen: boolean;
  openTour: () => void;
  closeTour: () => void;
  profileSetupOpen: boolean;
  openProfileSetup: () => void;
  closeProfileSetup: () => void;
  refreshMarket: () => void;
  /** In-app notifications for order fills and price alerts. */
  toasts: Toast[];
  dismissToast: (id: number) => void;
  /** Which data scope is active: "guest" (this device) or "cloud:<uid>". Used to keep per-account local data, such as coach chat history, apart. */
  storageScope: string;
  actions: {
    buy: (input: TradeInput) => void;
    sell: (input: TradeInput) => void;
    placeOrder: (input: orderOps.OrderInput) => void;
    cancelOrder: (id: string) => void;
    clearClosedOrders: () => void;
    toggleWatch: (symbol: string) => void;
    addAlert: (input: alertOps.AlertInput) => void;
    removeAlert: (id: string) => void;
    deposit: (amount: number, note?: string) => void;
    withdraw: (amount: number, note?: string) => void;
    addThesis: (input: { symbol: string; title: string; rationale: string; risks?: string; conviction?: number }) => void;
    updateThesis: (id: string, patch: { title?: string; rationale?: string; risks?: string; conviction?: number }) => void;
    removeThesis: (id: string) => void;
    linkHoldingToThesis: (holdingId: string, thesisId: string | undefined) => void;
    setProfileName: (name: string) => void;
    saveProfile: (input: mutations.ProfileInput) => void;
    completeOnboarding: () => void;
    reset: () => void;
    importJson: (raw: string) => void;
    exportJson: () => string;
    // v4
    updateSettings: (patch: Partial<Settings>) => void;
    recordDisciplineMilestone: (milestone: number) => void;
    /** Hide the sample starter portfolio banner (keep the sample). */
    dismissStarter: () => void;
    /** Replace the sample starter portfolio with cash only. */
    startFresh: (cash?: number) => void;
    setStressTest: (thesisId: string, input: stressOps.StressTestInput) => void;
    clearStressTest: (thesisId: string) => void;
    startReplay: (scenarioId: string) => void;
    replayTrade: (input: replayOps.ReplayTradeInput) => void;
    stepReplay: (by: number | "end") => ReplayResult | null;
    endReplay: () => void;
    rememberLeague: (code: string) => void;
    forgetLeague: (code: string) => void;
    // v5
    reviewTrade: (txId: string, input: { rating: number; lesson?: string }) => void;
    setGoals: (goals: readonly AppState["profile"]["goals"][number][]) => void;
    awardBadges: (ids: string[]) => void;
    saveReport: (report: WeeklyReport) => void;
    /** Swap a report's tip (e.g. for the AI coach's), only if the report still exists. */
    setReportTip: (week: string, tip: string, source: WeeklyReport["tipSource"]) => void;
  };
};

export type TradeInput = { symbol: string; shares: number; price: number; mood?: Mood; dayChange?: number; plan?: TradePlan };

const AppContext = createContext<AppApi | null>(null);

const MAX_REQUEST_SYMBOLS = 20;

/**
 * Symbols to quote, most important first. The network feed is capped at 20; the
 * local simulated feed has no cap, so every holding, order and alert gets a quote.
 */
export function requestSymbols(state: AppState | null, limit: number = MAX_REQUEST_SYMBOLS): string[] {
  const universe = DEMO_UNIVERSE.map((entry) => entry.symbol);
  if (!state) return universe.slice(0, limit);
  const held = portfolioSymbols(state);
  // Pending orders and active alerts must be quoted for the fill engine / alerts to work.
  const orderSymbols = state.orders.filter((o) => o.status === "open").map((o) => normalizeSymbol(o.symbol));
  const alertSymbols = state.alerts.filter((a) => a.status === "active").map((a) => normalizeSymbol(a.symbol));
  const watched = state.watchlist.map(normalizeSymbol);
  // Include thesis symbols so the market API returns a quote for every thesis,
  // even one written about a ticker that isn't currently held.
  const thesisSymbols = state.theses.map((t) => normalizeSymbol(t.symbol));
  return Array.from(
    new Set([BENCHMARK_SYMBOL, ...held, ...orderSymbols, ...alertSymbols, ...watched, ...thesisSymbols, ...universe]),
  ).slice(0, limit);
}

export function AppProvider({ mode: storageMode, children }: { mode: StorageMode; children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const syncState = useSyncExternalStore(subscribe, getSyncSnapshot, getServerSyncSnapshot);
  const toastList = useSyncExternalStore(subscribe, getToastsSnapshot, getServerToastsSnapshot);
  const [market, setMarket] = useState<MarketState>({ status: "loading", quotes: [] });
  const [manualTourOpen, setManualTourOpen] = useState(false);
  const [manualProfileOpen, setManualProfileOpen] = useState(false);

  const modeKey = storageMode.kind === "cloud" ? `cloud:${storageMode.uid}` : "guest";
  const backend: CloudBackend = storageMode.kind === "cloud" ? (storageMode.backend ?? "firebase") : "firebase";
  useEffect(() => {
    activate(modeKey === "guest" ? { kind: "guest" } : { kind: "cloud", uid: modeKey.slice("cloud:".length), backend });
  }, [modeKey, backend]);

  // Don't lose the last debounced change when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => void flushCloudSave({ onExit: true });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // First-run flow (all derived — no set-state-in-effect):
  // 1) brand-new users complete profile setup, then 2) the feature tour.
  const profileSetupOpen = manualProfileOpen || (Boolean(state) && !state?.profileSetupAt);
  const tourOpen =
    manualTourOpen || (Boolean(state) && Boolean(state?.profileSetupAt) && !state?.onboardedAt);

  const symbolsKey = requestSymbols(state).sort().join(",");
  const allSymbolsKey = requestSymbols(state, Number.POSITIVE_INFINITY).sort().join(",");

  // setState lives inside the promise callbacks (not synchronously in an effect),
  // which is the pattern React recommends for syncing with an external system.
  const refreshMarket = useCallback(() => {
    const symbols = symbolsKey ? symbolsKey.split(",") : [];
    const allSymbols = allSymbolsKey ? allSymbolsKey.split(",") : symbols;
    const publish = (next: MarketState) => {
      announceFeed(next);
      setMarket(next);
    };
    const simulate = (demoReason: MarketState["demoReason"]) => {
      const snapshot = demoSnapshot(allSymbols);
      publish({ status: "demo", quotes: snapshot.quotes, updatedAt: snapshot.updatedAt, feed: "demo", demoReason });
    };

    // Real quotes through the Sentia API (the Cloudflare Worker). The API key stays
    // on the server; symbols it can't price stay unpriced rather than simulated.
    if (apiConfigured()) {
      fetchLiveQuotes(allSymbols)
        .then((live) =>
          publish({
            status: live.marketState === "open" ? "open" : "closed",
            quotes: live.quotes,
            updatedAt: live.asOf,
            feed: "live",
            session: live.marketState,
            missing: live.missing,
          }),
        )
        .catch(() => simulate(usingSentiaCoachApi() ? "not-configured" : "unreachable"));
      return;
    }

    // Static export without an API: simulated prices, clearly labelled.
    if (IS_STATIC_EXPORT) {
      simulate("not-configured");
      return;
    }

    // Server builds: the app's own /api/market route (keeps any key server-side).
    fetch(`/api/market?symbols=${encodeURIComponent(symbolsKey)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Market request failed (${res.status})`);
        return (await res.json()) as MarketSnapshot;
      })
      .then((snapshot) => {
        const real = snapshot.quotes.filter((q) => q.source !== "demo");
        if (snapshot.status === "demo" || real.length === 0) {
          simulate("not-configured");
          return;
        }
        // Never mix: drop any simulated fallbacks the route added for symbols it couldn't price.
        const realSymbols = new Set(real.map((q) => q.symbol));
        publish({
          status: snapshot.status,
          quotes: real.map((q) => ({ ...q, asOf: q.asOf ?? snapshot.updatedAt })),
          updatedAt: snapshot.updatedAt,
          feed: "live",
          missing: snapshot.quotes.filter((q) => !realSymbols.has(q.symbol)).map((q) => q.symbol),
        });
      })
      .catch(() => simulate("not-configured"));
  }, [symbolsKey, allSymbolsKey]);

  // Poll once state exists. Keyed on presence (not the state object) so ordinary
  // edits don't refetch quotes and restart the 15s timer; a new symbol to quote
  // changes refreshMarket and re-runs this effect.
  const hasState = Boolean(state);
  useEffect(() => {
    if (!hasState) return;
    refreshMarket();
    const id = setInterval(refreshMarket, MARKET_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasState, refreshMarket]);

  // The built-in host (api.sentiacoach.com) stays on demo prices until /health
  // answers. A miss does not pause orders. An explicit API URL is already configured.
  useEffect(() => {
    if (!hasState || apiConfigured()) return;
    let cancel = false;
    void probeSentiaCoachApi().then((ok) => {
      if (!cancel && ok) refreshMarket();
    });
    return () => {
      cancel = true;
    };
  }, [hasState, refreshMarket]);

  // Each price update (and each state change, e.g. a newly placed order) runs the
  // fill engine, price alerts and performance snapshotting. Idempotent: reads and
  // writes the module store, so a re-run with the same quotes is a no-op.
  // While a configured live service is unreachable we show demo prices, but orders,
  // alerts and performance snapshots pause so nothing executes on simulated prices.
  const tickPaused = market.demoReason === "unreachable";
  useEffect(() => {
    if (!state || market.quotes.length === 0 || tickPaused) return;
    applyMarketTick(market.quotes);
  }, [state, market.quotes, tickPaused]);

  const summary = useMemo(() => (state ? summarizePortfolio(state, market.quotes) : null), [state, market.quotes]);

  // The coach chat is per storage scope; Start fresh / Reset clear the current scope's chat
  // so the coach never cites positions that no longer exist.
  const scopeRef = useRef(modeKey);
  useEffect(() => {
    scopeRef.current = modeKey;
  }, [modeKey]);

  const actions = useMemo<AppApi["actions"]>(
    () => ({
      buy: ({ mood, dayChange, plan, ...input }) => mutate((s) => mutations.buy(s, input, "", { mood, dayChange, plan })),
      sell: ({ mood, dayChange, ...input }) => mutate((s) => mutations.sell(s, input, "", { mood, dayChange })),
      placeOrder: (input) => mutate((s) => orderOps.placeOrder(s, input)),
      cancelOrder: (id) => mutate((s) => orderOps.cancelOrder(s, id)),
      clearClosedOrders: () => mutate((s) => orderOps.clearClosedOrders(s)),
      toggleWatch: (symbol) => mutate((s) => alertOps.toggleWatch(s, symbol)),
      addAlert: (input) => mutate((s) => alertOps.addAlert(s, input)),
      removeAlert: (id) => mutate((s) => alertOps.removeAlert(s, id)),
      deposit: (amount, note) => mutate((s) => mutations.deposit(s, amount, note)),
      withdraw: (amount, note) => mutate((s) => mutations.withdraw(s, amount, note)),
      addThesis: (input) => mutate((s) => mutations.addThesis(s, input)),
      updateThesis: (id, patch) => mutate((s) => mutations.updateThesis(s, id, patch)),
      removeThesis: (id) => mutate((s) => mutations.removeThesis(s, id)),
      linkHoldingToThesis: (holdingId, thesisId) => mutate((s) => mutations.linkHoldingToThesis(s, holdingId, thesisId)),
      setProfileName: (name) => mutate((s) => mutations.setProfileName(s, name)),
      saveProfile: (input) => mutate((s) => mutations.saveProfile(s, input)),
      completeOnboarding: () => mutate((s) => mutations.completeOnboarding(s)),
      reset: () => {
        clearCoachHistory(browserHistoryStorage(), scopeRef.current);
        setCurrent(mutations.createInitialState());
      },
      importJson: (raw) => setCurrent(mutations.importStateJson(raw)),
      exportJson: () => (current ? mutations.exportStateJson(current) : "{}"),
      updateSettings: (patch) => mutate((s) => mutations.updateSettings(s, patch)),
      recordDisciplineMilestone: (m) => mutate((s) => mutations.recordDisciplineMilestone(s, m)),
      dismissStarter: () => mutate((s) => mutations.dismissStarterNotice(s)),
      startFresh: (cash) => {
        clearCoachHistory(browserHistoryStorage(), scopeRef.current);
        mutate((s) => mutations.startFresh(s, cash ?? mutations.freshStartCash(s)));
      },
      setStressTest: (thesisId, input) => mutate((s) => stressOps.setStressTest(s, thesisId, input)),
      clearStressTest: (thesisId) => mutate((s) => stressOps.clearStressTest(s, thesisId)),
      startReplay: (scenarioId) => mutate((s) => replayOps.startReplay(s, scenarioId)),
      replayTrade: (input) => mutate((s) => replayOps.replayTrade(s, input)),
      stepReplay,
      endReplay: () => mutate((s) => replayOps.endReplay(s)),
      rememberLeague: (code) => mutate((s) => mutations.rememberLeague(s, code)),
      forgetLeague: (code) => mutate((s) => mutations.forgetLeague(s, code)),
      reviewTrade: (txId, input) => mutate((s) => mutations.reviewTrade(s, txId, input)),
      setGoals: (goals) => mutate((s) => mutations.setPracticeGoals(s, goals)),
      awardBadges: (ids) => mutate((s) => challengeOps.awardBadges(s, ids)),
      saveReport: (report) => mutate((s) => mutations.commit({ ...s, reports: upsertReport(s.reports, report) })),
      setReportTip: (week, tip, source) =>
        mutate((s) =>
          s.reports.some((r) => r.week === week)
            ? mutations.commit({ ...s, reports: s.reports.map((r) => (r.week === week ? { ...r, tip: tip.trim().slice(0, 900), tipSource: source } : r)) })
            : s,
        ),
    }),
    [],
  );

  const value: AppApi = {
    ready: Boolean(state),
    state,
    summary,
    market,
    quotes: market.quotes,
    sync: syncState,
    tourOpen,
    openTour: () => setManualTourOpen(true),
    closeTour: () => setManualTourOpen(false),
    profileSetupOpen,
    openProfileSetup: () => setManualProfileOpen(true),
    closeProfileSetup: () => setManualProfileOpen(false),
    refreshMarket: () => void refreshMarket(),
    toasts: toastList,
    dismissToast,
    storageScope: modeKey,
    actions,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within an AppProvider.");
  return ctx;
}
