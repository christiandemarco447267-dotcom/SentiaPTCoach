import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCoachHistory,
  COACH_HISTORY_MAX_MESSAGES,
  COACH_HISTORY_PREFIX,
  coachHistoryKey,
  loadCoachHistory,
  nextMessageId,
  parseStoredHistory,
  saveCoachHistory,
  toStoredMessages,
  type LiveMessage,
} from "./coach-history";
import { isSentiaKey } from "./data-deletion";

class MemoryStorage {
  map = new Map<string, string>();
  failNextSet = 0;
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    if (this.failNextSet > 0) {
      this.failNextSet -= 1;
      throw new Error("QuotaExceededError");
    }
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const welcome: LiveMessage = { id: 0, role: "coach", text: "Hi, I'm Sentia." };
const convo: LiveMessage[] = [
  welcome,
  { id: 1, role: "user", text: "How concentrated am I?", at: 1 },
  {
    id: 2,
    role: "coach",
    text: "Your top holding is 40%.",
    mode: "builtin",
    reply: { intent: "concentration", text: "Your top holding is 40%.", links: [{ href: "/app/allocate", label: "See allocation" }] },
    at: 2,
  },
  { id: 3, role: "user", text: "What is diversification?", at: 3 },
  { id: 4, role: "coach", text: "Spreading risk.", mode: "ai", at: 4 },
];

test("history survives a save/load round trip (simulated reload)", () => {
  const storage = new MemoryStorage();
  assert.equal(saveCoachHistory(storage, "guest", convo), true);
  const loaded = loadCoachHistory(storage, "guest");
  assert.equal(loaded.length, 4, "welcome message is not stored");
  assert.deepEqual(
    loaded.map((m) => m.id),
    [1, 2, 3, 4],
  );
  assert.equal(loaded[1].reply?.links?.[0].href, "/app/allocate");
  assert.equal(loaded[3].mode, "ai");
  assert.equal(nextMessageId(loaded), 5);
});

test("each account scope has its own history", () => {
  const storage = new MemoryStorage();
  saveCoachHistory(storage, "cloud:alice", convo);
  saveCoachHistory(storage, "cloud:bob", [welcome, { id: 1, role: "user", text: "bob's question" }]);
  assert.equal(loadCoachHistory(storage, "cloud:alice").length, 4);
  assert.equal(loadCoachHistory(storage, "cloud:bob")[0].text, "bob's question");
  assert.equal(loadCoachHistory(storage, "guest").length, 0);
});

test("history keys are covered by Delete my data", () => {
  assert.ok(coachHistoryKey("guest").startsWith(COACH_HISTORY_PREFIX));
  assert.ok(isSentiaKey(coachHistoryKey("guest")));
  assert.ok(isSentiaKey(coachHistoryKey("cloud:abc123")));
});

test("streaming (unfinished) answers are not saved", () => {
  const stored = toStoredMessages([...convo, { id: 5, role: "coach", text: "Half an ans", mode: "ai", streaming: true }]);
  assert.equal(stored.at(-1)?.id, 4);
});

test("only the newest messages are kept past the cap", () => {
  const many: LiveMessage[] = Array.from({ length: COACH_HISTORY_MAX_MESSAGES + 30 }, (_, i) => ({ id: i + 1, role: "user", text: `q${i + 1}` }));
  const stored = toStoredMessages(many);
  assert.equal(stored.length, COACH_HISTORY_MAX_MESSAGES);
  assert.equal(stored.at(-1)?.text, `q${COACH_HISTORY_MAX_MESSAGES + 30}`);
});

test("corrupt or foreign data loads as an empty history instead of crashing", () => {
  assert.deepEqual(parseStoredHistory("not json"), []);
  assert.deepEqual(parseStoredHistory(JSON.stringify({ v: 99, messages: [] })), []);
  assert.deepEqual(parseStoredHistory(null), []);
  const mixed = JSON.stringify({ v: 1, updatedAt: 1, messages: [{ id: 1, role: "user", text: "ok" }, { id: "x" }, { id: 2, role: "hacker", text: "no" }] });
  assert.deepEqual(
    parseStoredHistory(mixed).map((m) => m.id),
    [1],
  );
});

test("tampered links (non in-app hrefs) are rejected", () => {
  const raw = JSON.stringify({
    v: 1,
    updatedAt: 1,
    messages: [{ id: 1, role: "coach", text: "x", reply: { intent: "x", text: "x", links: [{ href: "javascript:alert(1)", label: "bad" }] } }],
  });
  assert.deepEqual(parseStoredHistory(raw), []);
  // When saving, a bad reply is dropped but the text is kept.
  const stored = toStoredMessages([{ id: 1, role: "coach", text: "kept", reply: { intent: "x", text: "x", links: [{ href: "https://evil.example", label: "bad" }] } }]);
  assert.equal(stored[0].text, "kept");
  assert.equal(stored[0].reply, undefined);
});

test("clear removes the history; an empty chat removes the key", () => {
  const storage = new MemoryStorage();
  saveCoachHistory(storage, "guest", convo);
  clearCoachHistory(storage, "guest");
  assert.equal(storage.map.size, 0);
  saveCoachHistory(storage, "guest", convo);
  saveCoachHistory(storage, "guest", [welcome]);
  assert.equal(storage.map.size, 0);
});

test("a full storage quota falls back to saving the newest half", () => {
  const storage = new MemoryStorage();
  storage.failNextSet = 1;
  assert.equal(saveCoachHistory(storage, "guest", convo), true);
  assert.equal(loadCoachHistory(storage, "guest").length, 4);
});

test("blocked storage never throws", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.deepEqual(loadCoachHistory(blocked, "guest"), []);
  assert.equal(saveCoachHistory(blocked, "guest", convo), false);
  assert.doesNotThrow(() => clearCoachHistory(blocked, "guest"));
  assert.deepEqual(loadCoachHistory(null, "guest"), []);
});
