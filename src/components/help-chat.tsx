"use client";

// Floating "Help" chat: answers questions about USING Sentia. FAQ answers come first, matched on
// the device (works offline). Anything else goes to the Sentia API's /support/chat (short answers
// grounded in the same FAQ). If neither can answer, it offers an email to support. This is separate
// from Ask Sentia, the investing coach, and never sees portfolio data.

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LifeBuoy, Mail, Send, X } from "lucide-react";
import { apiConfigured, apiUrl, probeSentiaCoachApi } from "@/lib/api-config";
import { bestFaq, faqById, looksLikeInvestingAdvice, looksLikeSecret, relatedFaqs, STARTER_FAQ_IDS, type Faq } from "@/lib/support-faq";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

const QUESTION_MAX = 400;

type Msg =
  | { id: number; from: "user"; text: string }
  | { id: number; from: "bot"; text: string; source?: "faq" | "ai"; faqId?: string; email?: string; related?: Faq[]; coachLink?: boolean };

type NewMsg = Omit<Extract<Msg, { from: "user" }>, "id"> | Omit<Extract<Msg, { from: "bot" }>, "id">;

async function askServer(question: string, history: Msg[]): Promise<{ answered: boolean; answer?: string }> {
  if (!apiConfigured()) await probeSentiaCoachApi();
  if (!apiConfigured()) return { answered: false };
  const turns = history
    .slice(-4)
    .map((m) => ({ role: m.from === "user" ? "user" : "assistant", text: m.text.slice(0, 600) }));
  try {
    const res = await fetch(apiUrl("/support/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history: turns }),
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { answered: false };
    const body = (await res.json()) as { answered?: boolean; answer?: string };
    return body.answered && typeof body.answer === "string" ? { answered: true, answer: body.answer } : { answered: false };
  } catch {
    return { answered: false };
  }
}

const noopSubscribe = () => () => undefined;

export function HelpChatLauncher({ className }: { className?: string }) {
  // Rendered into <body> so a glass (backdrop-filter) parent can't trap the fixed position.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    <>
      <button
        ref={launcherRef}
        type="button"
        className={className ? `help-launcher ${className}` : "help-launcher"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        hidden={open}
      >
        <LifeBuoy size={18} aria-hidden="true" />
        <span>Help</span>
      </button>
      {open ? <HelpChatPanel onClose={() => setOpen(false)} /> : null}
    </>,
    document.body,
  );
}

function HelpChatPanel({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const nextId = useRef(1);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled])")];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy]);

  const push = (m: NewMsg) => setMessages((all) => [...all, { ...m, id: nextId.current++ } as Msg]);

  const answerFaq = (faq: Faq, question: string) =>
    push({ from: "bot", text: faq.a, source: "faq", faqId: faq.id, related: relatedFaqs(question, faq.id, 2) });

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, QUESTION_MAX);
    if (question.length < 2 || busy) return;
    const history = messages;
    push({ from: "user", text: question });
    setText("");
    if (looksLikeSecret(question)) {
      push({ from: "bot", text: "For your safety, please don't share codes or passwords here. Nobody at Sentia will ever ask for them. If you shared a password, change it in Settings." });
      return;
    }
    if (looksLikeInvestingAdvice(question)) {
      push({ from: "bot", text: "This Help chat only covers using Sentia, and Sentia never gives investment advice. To learn how to think through an idea, open Ask Sentia in the app.", coachLink: true });
      return;
    }
    const match = bestFaq(question);
    if (match) {
      answerFaq(match.faq, question);
      return;
    }
    setBusy(true);
    const server = await askServer(question, history);
    setBusy(false);
    if (server.answered && server.answer) {
      push({ from: "bot", text: server.answer, source: "ai", email: question });
    } else {
      push({ from: "bot", text: "I'm not sure about that one. Our team can help by email.", email: question, related: relatedFaqs(question, null, 2) });
    }
  };

  return (
    <div className="help-layer">
      <div ref={panelRef} className="help-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="help-head">
          <span className="help-head-icon" aria-hidden="true">
            <LifeBuoy size={18} />
          </span>
          <div className="help-head-text">
            <h2 id={titleId}>Sentia Help</h2>
            <span className="small muted">Answers about using Sentia</span>
          </div>
          <button type="button" className="btn btn-icon btn-quiet" onClick={onClose} aria-label="Close help">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <ol ref={listRef} className="help-messages" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
          <li className="help-msg help-msg-bot">
            <p>Hi! Ask a question about accounts, saving, prices or anything else in Sentia. Popular topics:</p>
            <div className="help-chips">
              {STARTER_FAQ_IDS.map((id) => {
                const faq = faqById(id);
                return faq ? (
                  <button key={id} type="button" className="help-chip" onClick={() => void ask(faq.q)} disabled={busy}>
                    {faq.q}
                  </button>
                ) : null;
              })}
            </div>
          </li>
          {messages.map((m) =>
            m.from === "user" ? (
              <li key={m.id} className="help-msg help-msg-user">
                <span className="sr-only">You: </span>
                <p>{m.text}</p>
              </li>
            ) : (
              <li key={m.id} className="help-msg help-msg-bot">
                <span className="sr-only">Help: </span>
                <p>{m.text}</p>
                {m.source ? <span className="help-source">{m.source === "faq" ? "From the FAQ" : "AI answer based on the FAQ. It can be wrong."}</span> : null}
                {m.coachLink ? (
                  <Link href="/app/coach" className="help-chip help-chip-link">
                    Open Ask Sentia
                  </Link>
                ) : null}
                {m.email !== undefined ? (
                  <a className="btn btn-sm help-email" href={supportMailto(`Sentia help: ${m.email.slice(0, 80)}`, `Hi Sentia team,\n\n${m.email}\n\n`)}>
                    <Mail size={15} aria-hidden="true" /> Email {SUPPORT_EMAIL}
                  </a>
                ) : null}
                {m.related?.length ? (
                  <div className="help-chips">
                    {m.related.map((f) => (
                      <button key={f.id} type="button" className="help-chip" onClick={() => void ask(f.q)} disabled={busy}>
                        {f.q}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ),
          )}
          {busy ? (
            <li className="help-msg help-msg-bot help-typing" role="status">
              <span className="sr-only">Looking that up…</span>
              <span aria-hidden="true" className="help-dots">
                <i />
                <i />
                <i />
              </span>
            </li>
          ) : null}
        </ol>

        <form
          className="help-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Your question
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, QUESTION_MAX))}
            placeholder="Type a question…"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={QUESTION_MAX}
          />
          <button type="submit" className="btn btn-primary btn-icon" disabled={busy || text.trim().length < 2} aria-label="Send question">
            <Send size={17} aria-hidden="true" />
          </button>
        </form>
        <p className="help-foot small">
          Not investment advice. <Link href="/support">All FAQs</Link> · <a href={supportMailto()}>Email support</a>
        </p>
      </div>
    </div>
  );
}
