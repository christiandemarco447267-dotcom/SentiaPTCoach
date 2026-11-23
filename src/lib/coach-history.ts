// Persistent Ask Sentia chat history.
//
// The coach conversation is saved on this device (localStorage on the web, the app's
// private WebView storage in the Android/iOS builds) so it survives reloads and
// return visits. Each storage scope gets its own history:
//   - "guest"         -> the local demo account on this device
//   - "cloud:<uid>"   -> one signed-in account, so two people sharing a browser
//                        never see each other's conversations
//
// Keys start with "sentia." so "Delete my data" (data-deletion.ts) removes them
// along with everything else Sentia keeps on the device.
//
// Everything here is pure and takes an injected storage object, so it is unit-testable
// without a browser.
import { z } from "zod";

export const COACH_HISTORY_PREFIX = "sentia.coach.history.v1:";
/** Oldest messages are dropped beyond this many (keeps storage small and the log readable). */
export const COACH_HISTORY_MAX_MESSAGES = 100;
/** Per-message text cap when saving (AI answers are ~120 words; this is generous). */
export const COACH_HISTORY_MAX_TEXT = 4000;

/** Minimal Storage surface (window.localStorage or a test double). */
export type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Only in-app links are restored (they render as <Link href>). Anything else in
// stored data, e.g. an edited "javascript:" URL, is dropped.
const InternalHref = z.string().regex(/^\/[A-Za-z0-9/_\-?=&#.]*$/).max(200);

const StoredReplySchema = z.object({
  intent: z.string().max(40),
  text: z.string().max(COACH_HISTORY_MAX_TEXT),
  bullets: z.array(z.string().max(500)).max(10).optional(),
  links: z.array(z.object({ href: InternalHref, label: z.string().max(80) })).max(5).optional(),
});

export const StoredMessageSchema = z.object({
  id: z.number().int().nonnegative(),
  role: z.enum(["user", "coach"]),
  text: z.string().max(COACH_HISTORY_MAX_TEXT),
  mode: z.enum(["ai", "builtin"]).optional(),
  note: z.string().max(300).optional(),
  reply: StoredReplySchema.optional(),
  /** When the message was added (ms since epoch). Optional for forward compatibility. */
  at: z.number().int().nonnegative().optional(),
});

export type StoredMessage = z.infer<typeof StoredMessageSchema>;

const StoredHistorySchema = z.object({
  v: z.literal(1),
  updatedAt: z.number().int().nonnegative(),
  messages: z.array(z.unknown()),
});

/** A message as the chat UI holds it (may be mid-stream). */
export type LiveMessage = StoredMessage & { streaming?: boolean };

/** Storage key for a scope ("guest" or "cloud:<uid>"). Unsafe characters are replaced. */
export function coachHistoryKey(scope: string): string {
  const clean = (scope || "guest").replace(/[^A-Za-z0-9:_\-]/g, "_").slice(0, 160);
  return `${COACH_HISTORY_PREFIX}${clean}`;
}

/**
 * Turn the live chat into what gets saved: drops the welcome message (id 0, it's
 * re-added on load), answers still streaming or empty, and anything over the caps.
 */
export function toStoredMessages(messages: readonly LiveMessage[], max: number = COACH_HISTORY_MAX_MESSAGES): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of messages) {
    if (m.id === 0 || m.streaming) continue;
    const text = (m.text ?? "").slice(0, COACH_HISTORY_MAX_TEXT);
    if (!text.trim() && !m.reply) continue;
    const candidate: StoredMessage = {
      id: m.id,
      role: m.role,
      text,
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.note ? { note: m.note.slice(0, 300) } : {}),
      ...(m.reply ? { reply: m.reply } : {}),
      ...(m.at ? { at: m.at } : {}),
    };
    const parsed = StoredMessageSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
    else {
      // Keep the text even if an attached reply has something odd in it.
      const plain = StoredMessageSchema.safeParse({ ...candidate, reply: undefined });
      if (plain.success) out.push(plain.data);
    }
  }
  // A user question whose answer never finished would sit alone at the end; that's fine,
  // it shows what was asked. Trim from the front so the newest messages are kept.
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Parse stored JSON. Unknown versions, corrupt JSON or bad entries yield [] / are skipped, never throw. */
export function parseStoredHistory(raw: string | null | undefined): StoredMessage[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const envelope = StoredHistorySchema.safeParse(data);
  if (!envelope.success) return [];
  const seen = new Set<number>();
  const messages: StoredMessage[] = [];
  for (const entry of envelope.data.messages) {
    const parsed = StoredMessageSchema.safeParse(entry);
    if (!parsed.success || parsed.data.id === 0 || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    messages.push(parsed.data);
  }
  messages.sort((a, b) => a.id - b.id);
  return messages.slice(-COACH_HISTORY_MAX_MESSAGES);
}

export function serializeHistory(messages: readonly LiveMessage[], now: number = Date.now()): string {
  return JSON.stringify({ v: 1, updatedAt: now, messages: toStoredMessages(messages) });
}

export function loadCoachHistory(storage: HistoryStorage | null | undefined, scope: string): StoredMessage[] {
  if (!storage) return [];
  try {
    return parseStoredHistory(storage.getItem(coachHistoryKey(scope)));
  } catch {
    return []; // storage blocked (private mode, disabled cookies)
  }
}

/** Save (or remove, when nothing is worth keeping). Returns false if storage refused (quota, blocked). */
export function saveCoachHistory(storage: HistoryStorage | null | undefined, scope: string, messages: readonly LiveMessage[]): boolean {
  if (!storage) return false;
  const key = coachHistoryKey(scope);
  try {
    if (toStoredMessages(messages).length === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, serializeHistory(messages));
    return true;
  } catch {
    // Quota exceeded: retry once with the newest half so the latest exchange survives.
    try {
      const half = toStoredMessages(messages, Math.floor(COACH_HISTORY_MAX_MESSAGES / 2));
      storage.setItem(key, JSON.stringify({ v: 1, updatedAt: Date.now(), messages: half }));
      return true;
    } catch {
      return false;
    }
  }
}

export function clearCoachHistory(storage: HistoryStorage | null | undefined, scope: string): void {
  if (!storage) return;
  try {
    storage.removeItem(coachHistoryKey(scope));
  } catch {
    // nothing to do
  }
}

/** Next message id after restored messages (ids must stay unique for React keys and streaming updates). */
export function nextMessageId(messages: readonly { id: number }[]): number {
  return messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;
}

/** window.localStorage when available, else null (SSR, blocked storage). */
export function browserHistoryStorage(): HistoryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
