"use client";

import clsx from "clsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchRemoteSymbols, searchSymbols, type SymbolEntry } from "@/lib/symbols";
import { nameForSymbol } from "@/lib/market";
import { useApp } from "@/lib/store";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when a suggestion is chosen (click / Enter on a highlighted row). */
  onPick?: (entry: SymbolEntry) => void;
  placeholder?: string;
  ariaLabel?: string;
  describedBy?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
};

/**
 * Ticker input with autocomplete (ARIA 1.2 combobox). Searches the app's symbol
 * directory plus your holdings/watchlist instantly, then merges the Sentia API's
 * /search results when that's available. Typing any valid ticker still works.
 */
export function SymbolSearch({ id, value, onChange, onPick, placeholder = "e.g. AAPL or Apple", ariaLabel, describedBy, className, style, autoFocus }: Props) {
  const { state } = useApp();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<{ q: string; items: SymbolEntry[] }>({ q: "", items: [] });
  const wrapRef = useRef<HTMLDivElement>(null);

  const mine = useMemo<SymbolEntry[]>(() => {
    if (!state) return [];
    const syms = new Set([...state.holdings.map((h) => h.symbol), ...state.watchlist]);
    return [...syms].map((s) => ({ symbol: s, name: nameForSymbol(s) }));
  }, [state]);

  const query = value.trim();
  const results = useMemo(() => searchSymbols(query, 8, [...mine, ...(remote.q === query ? remote.items : [])]), [query, mine, remote]);

  // Debounced remote lookup; the callback (not the effect body) sets state.
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      void searchRemoteSymbols(query, controller.signal).then((items) => {
        if (!controller.signal.aborted) setRemote({ q: query, items });
      });
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const showList = open && results.length > 0 && !(results.length === 1 && results[0].symbol === query.toUpperCase());

  const pick = (entry: SymbolEntry) => {
    onChange(entry.symbol);
    onPick?.(entry);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (results.length ? (i + 1) % results.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i <= 0 ? results.length - 1 : i - 1) : -1));
    } else if (e.key === "Enter" && showList && active >= 0 && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div ref={wrapRef} className={clsx("combo", className)} style={style}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase().slice(0, 30));
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={30}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus={autoFocus}
      />
      <ul id={listId} role="listbox" className="combo-list" hidden={!showList} aria-label="Matching tickers">
        {showList
          ? results.map((r, i) => (
              <li
                key={r.symbol}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={clsx("combo-option", i === active && "active")}
                onPointerDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  pick(r);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="combo-sym">{r.symbol}</span>
                <span className="combo-name">{r.name}</span>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
