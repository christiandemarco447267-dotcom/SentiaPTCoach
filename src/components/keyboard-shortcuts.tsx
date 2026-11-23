"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { resolveShortcut, SHORTCUT_HELP, TRADE_SIDE_EVENT, type ShortcutState } from "@/lib/shortcuts";
import { Dialog } from "./dialog";

function focusSearch(): boolean {
  const el = document.querySelector<HTMLInputElement>("main input[role='combobox'], main input[type='search'], [data-shortcut-search]");
  if (!el) return false;
  el.focus();
  el.select?.();
  return true;
}

/** Desktop keyboard shortcuts for the app (see SHORTCUT_HELP). Press ? for the cheat sheet. */
export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [helpOpen, setHelpOpen] = useState(false);
  const seq = useRef<ShortcutState>({ pendingG: null });
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { action, state } = resolveShortcut(e, e.target as HTMLElement | null, seq.current, Date.now());
      seq.current = state;
      if (!action) return;
      const onTrade = /\/app\/trade\/?$/.test(pathRef.current);
      switch (action.kind) {
        case "help":
          e.preventDefault();
          setHelpOpen(true);
          return;
        case "search":
          e.preventDefault();
          if (!focusSearch()) router.push("/app/trade?focus=search");
          return;
        case "side":
          e.preventDefault();
          if (onTrade) window.dispatchEvent(new CustomEvent(TRADE_SIDE_EVENT, { detail: action.side }));
          else router.push(`/app/trade?side=${action.side}`);
          return;
        case "nav":
          e.preventDefault();
          router.push(action.href);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} labelledBy="shortcuts-title">
      <div className="row between gap-sm">
        <h2 id="shortcuts-title" className="row gap-sm" style={{ margin: 0, fontSize: "1.15rem" }}>
          <Keyboard size={18} aria-hidden="true" /> Keyboard shortcuts
        </h2>
        <button type="button" className="btn btn-icon btn-sm" onClick={() => setHelpOpen(false)} aria-label="Close shortcuts">
          <X size={16} />
        </button>
      </div>
      <ul className="shortcut-list">
        {SHORTCUT_HELP.map((s) => (
          <li key={s.label}>
            <span>{s.label}</span>
            <span className="shortcut-keys">
              {s.keys.map((k, i) => (
                <span key={k} className="row" style={{ gap: 4 }}>
                  {i > 0 ? <span className="small dim">then</span> : null}
                  <kbd className="kbd">{k}</kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ margin: 0 }}>
        Shortcuts pause while you type in a field.
      </p>
    </Dialog>
  );
}
