"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Cpu, History, MessageCircle, Send, Sparkles, Trash2 } from "lucide-react";
import { aiCoachConfigured, askAiCoach, CoachFallback } from "@/lib/ai-coach";
import { track } from "@/lib/analytics";
import { COACH_DISCLAIMER, ruleBasedAnswer, SUGGESTED_QUESTIONS, type CoachReply } from "@/lib/coach";
import {
  browserHistoryStorage,
  clearCoachHistory,
  loadCoachHistory,
  nextMessageId,
  saveCoachHistory,
  type StoredMessage,
} from "@/lib/coach-history";
import { buildCoachContext } from "@/lib/coach-context";
import { useApp } from "@/lib/store";
import { Loading, Panel, PageHeader } from "./ui";

type Mode = "ai" | "builtin";
type Message = {
  id: number;
  role: "user" | "coach";
  text: string;
  reply?: CoachReply;
  /** Which coach answered (shown on every coach message). */
  mode?: Mode;
  /** Why the built-in coach answered a typed question instead of the AI. */
  note?: string;
  streaming?: boolean;
};

const AI_ENABLED = aiCoachConfigured();

const WELCOME: Message = {
  id: 0,
  role: "coach",
  text: "Hi, I'm Sentia. Ask me about your paper portfolio — concentration, cash, winners and losers, theses, biases or your Discipline Score.",
};

function restore(stored: StoredMessage[]): Message[] {
  // Stored replies were validated on load (text caps, in-app links only).
  return [WELCOME, ...stored.map((m) => ({ ...m, reply: m.reply as CoachReply | undefined }))];
}

export function CoachView() {
  const { ready, state, summary, storageScope } = useApp();
  if (!ready || !state || !summary) return <Loading />;
  // Keyed by scope: switching accounts (or guest <-> signed in) loads that account's own history.
  return <CoachChat key={storageScope} scope={storageScope} />;
}

function CoachChat({ scope }: { scope: string }) {
  const { state, summary, quotes } = useApp();
  // Rendered only on the client after the store is ready, so reading localStorage here can't cause a hydration mismatch.
  const [initial] = useState(() => loadCoachHistory(browserHistoryStorage(), scope));
  const [messages, setMessages] = useState<Message[]>(() => restore(initial));
  const [restoredCount, setRestoredCount] = useState(initial.length);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const seq = useRef(nextMessageId(initial));

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Persist after every change. Answers still streaming are skipped and saved once they finish.
  useEffect(() => {
    saveCoachHistory(browserHistoryStorage(), scope, messages);
  }, [messages, scope]);

  if (!state || !summary) return <Loading />;

  const clearChat = () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("Clear your conversation with Sentia on this device?")) return;
    clearCoachHistory(browserHistoryStorage(), scope);
    seq.current = 1;
    setRestoredCount(0);
    setMessages([WELCOME]);
  };

  const builtIn = (q: string, note?: string): Message => {
    const reply = ruleBasedAnswer(q, { state, summary });
    return { id: seq.current++, role: "coach", text: reply.text, reply, mode: "builtin", note };
  };

  /** Chips always use the instant built-in coach; typed questions use the AI coach when available. */
  const ask = async (question: string, via: "chip" | "typed" = "typed") => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    track("coach_asked");
    const userMsg: Message = { id: seq.current++, role: "user", text: q.slice(0, 300) };
    setMessages((m) => [...m, userMsg]);

    if (via === "chip" || !AI_ENABLED) {
      setMessages((m) => [...m, builtIn(q)]);
      return;
    }

    setBusy(true);
    const id = seq.current++;
    setMessages((m) => [...m, { id, role: "coach", text: "", mode: "ai", streaming: true }]);
    try {
      const context = buildCoachContext({ state, summary, quotes });
      const text = await askAiCoach(q, context, (soFar) =>
        setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text: soFar } : msg))),
      );
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text, streaming: false } : msg)));
    } catch (error) {
      const why = error instanceof CoachFallback ? error.message : "The AI coach is unavailable.";
      const fallback = builtIn(q, `${why} Answered by the built-in coach instead.`);
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...fallback, id } : msg)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack gap-lg animate-in">
      <PageHeader
        title="Ask Sentia"
        subtitle={
          AI_ENABLED
            ? "A coach that answers from your own paper account. Typed questions go to the AI coach; the quick chips answer instantly on this device."
            : "A coach that answers from your own paper account. Runs entirely on this device."
        }
      />

      <Panel strong className="stack gap-md">
        <div className="row between wrap gap-sm">
          <strong className="row gap-sm">
            <MessageCircle size={18} /> Coach
          </strong>
          <div className="row gap-sm wrap">
          <span className="pill pill-compact" title={AI_ENABLED ? "Typed questions: AI coach. Chips and fallback: built-in coach." : "The AI coach isn't set up on this build."}>
            <Sparkles size={13} /> {AI_ENABLED ? "AI coach + built-in" : "Built-in coach · offline"}
          </span>
          {messages.length > 1 ? (
            <button type="button" className="btn btn-sm" onClick={clearChat} disabled={busy} aria-label="Clear chat history">
              <Trash2 size={14} /> Clear chat
            </button>
          ) : null}
          </div>
        </div>
        {restoredCount > 0 ? (
          <p className="small dim row gap-sm" role="status">
            <History size={13} /> Picked up where you left off. Your chat is saved on this device only.
          </p>
        ) : null}
        <div className="chat-log" ref={logRef} aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-coach"}`} aria-busy={m.streaming || undefined}>
              {m.mode ? (
                <span className={`coach-mode coach-mode-${m.mode}`}>
                  {m.mode === "ai" ? <Bot size={12} /> : <Cpu size={12} />} {m.mode === "ai" ? "AI coach" : "Built-in coach"}
                </span>
              ) : null}
              <span className="coach-text">{m.text || (m.streaming ? "Thinking…" : "")}</span>
              {m.note ? <span className="small dim coach-note">{m.note}</span> : null}
              {m.reply?.bullets?.length ? (
                <ul className="small">
                  {m.reply.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {m.reply?.links?.length ? (
                <div className="row wrap gap-sm" style={{ marginTop: 10 }}>
                  {m.reply.links.map((l) => (
                    <Link key={l.href} href={l.href} className="btn btn-sm">
                      {l.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="row wrap gap-sm" aria-label="Suggested questions">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => void ask(q, "chip")} disabled={busy}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="row gap-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <input
            className="input grow"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your portfolio…"
            maxLength={300}
            aria-label="Your question"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </Panel>

      <p className="disclaimer">
        {COACH_DISCLAIMER}{" "}
        {AI_ENABLED
          ? "Built-in answers come from simple rules applied to your data. AI answers are generated by a language model from a short summary of your paper account (holdings, recent trades, scores and theses — never your name or email) and can be wrong; check them against your own numbers."
          : "Answers come from simple rules applied to your simulated data."}
      </p>
    </div>
  );
}
