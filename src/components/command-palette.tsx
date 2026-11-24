"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { CornerDownLeft, FileText, Search, TrendingUp, X } from "lucide-react";
import { isFirebaseConfigured } from "@/lib/firebase-config";
import { nameForSymbol } from "@/lib/market";
import { paletteResults } from "@/lib/nav";
import { useApp } from "@/lib/store";
import { Dialog } from "./dialog";

/** Opens the search palette from anywhere (keyboard "/" or a search button). */
export const OPEN_PALETTE_EVENT = "sentia:open-palette";

export function openSearchPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

/** "/" search: jump to a ticker (opens Trade) or to any page. Arrow keys + Enter, Esc closes. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="palette-title" className="palette">
      {open ? <PaletteBody onClose={onClose} /> : null}
    </Dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { state } = useApp();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const mine = useMemo(() => {
    if (!state) return [];
    const syms = new Set([...state.holdings.map((h) => h.symbol), ...state.watchlist]);
    return [...syms].map((s) => ({ symbol: s, name: nameForSymbol(s) }));
  }, [state]);
  const results = useMemo(() => paletteResults(query, isFirebaseConfigured, mine), [query, mine]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (Math.min(i, results.length - 1) + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (Math.min(i, results.length - 1) <= 0 ? results.length - 1 : Math.min(i, results.length - 1) - 1) : 0));
    } else if (e.key === "Enter" && results[current]) {
      e.preventDefault();
      go(results[current].href);
    }
  };

  return (
    <div className="stack gap-md">
      <div className="row between gap-sm">
        <h2 id="palette-title" className="row gap-sm" style={{ margin: 0, fontSize: "1.1rem" }}>
          <Search size={18} aria-hidden="true" /> Search Sentia
        </h2>
        <button type="button" className="btn btn-icon btn-sm" onClick={onClose} aria-label="Close search">
          <X size={16} />
        </button>
      </div>
      <input
        className="input"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results[current] ? `${listId}-${current}` : undefined}
        aria-label="Search tickers and pages"
        placeholder="Ticker (AAPL) or page (Watchlist)…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value.slice(0, 40));
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        data-autofocus
      />
      <ul id={listId} role="listbox" className="palette-list" aria-label="Results">
        {results.map((r, i) => (
          <li
            key={r.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === current}
            className={clsx("palette-item", i === current && "active")}
            onPointerDown={(e) => {
              e.preventDefault();
              go(r.href);
            }}
            onMouseEnter={() => setActive(i)}
          >
            <span className="palette-icon" aria-hidden="true">
              {r.kind === "ticker" ? <TrendingUp size={16} /> : <FileText size={16} />}
            </span>
            <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
              <strong>{r.kind === "ticker" ? `Trade ${r.label}` : r.label}</strong>
              <span className="small dim palette-detail">{r.detail}</span>
            </span>
            {i === current ? <CornerDownLeft size={14} aria-hidden="true" className="dim" /> : null}
          </li>
        ))}
        {results.length === 0 ? <li className="small muted" style={{ padding: 10 }}>No matches. Try a ticker like VTI or a page name.</li> : null}
      </ul>
      <p className="small dim" style={{ margin: 0 }}>
        ↑ ↓ to move, Enter to open, Esc to close.
      </p>
    </div>
  );
}
