"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import { pickCounter, pickLocked, togglePick } from "@/lib/multi-pick";
import { MAX_SETUP_PICKS } from "@/lib/types";

export type ChoiceOption<T extends string> = { value: T; label: string; hint?: string };

/**
 * "Pick up to 3" question (v6). Each option is a checkbox (role="checkbox",
 * aria-checked) with a 44px+ tap target; Space/Enter toggle it. Once the limit is
 * reached the other options are aria-disabled (still focusable, so screen readers
 * can hear why) and a live "2 of 3" counter plus an "Up to 3" hint explain it.
 */
export function MultiChoice<T extends string>({
  options,
  selected,
  onChange,
  labelledBy,
  max = MAX_SETUP_PICKS,
  min = 0,
  compact = false,
}: {
  options: readonly ChoiceOption<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  labelledBy: string;
  max?: number;
  /** Shown as a hint only; the parent decides whether to block "Next". */
  min?: number;
  compact?: boolean;
}) {
  const full = selected.length >= max;
  const counterId = `${labelledBy}-count`;
  return (
    <div className="stack gap-sm">
      <div className="row between pick-meta">
        <span className="small dim">{min > 0 ? `Pick ${min === 1 ? "at least 1" : `at least ${min}`}, up to ${max}` : `Pick up to ${max}`}</span>
        <span id={counterId} className={clsx("pick-count small", full && "pick-count-full")} aria-live="polite">
          {pickCounter(selected.length, max)}
          {full ? <span className="pick-limit"> · Up to {max}</span> : null}
        </span>
      </div>
      <div className={clsx("stack gap-sm", compact && "choice-grid")} role="group" aria-labelledby={labelledBy} aria-describedby={counterId}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          const locked = pickLocked(selected, o.value, max);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-disabled={locked || undefined}
              className={clsx("choice choice-multi", on && "selected", locked && "is-locked", compact && "choice-compact")}
              onClick={() => {
                if (!locked) onChange(togglePick(selected, o.value, max));
              }}
            >
              <span className="choice-box" aria-hidden="true">
                {on ? <Check size={14} strokeWidth={3} /> : null}
              </span>
              <span className="choice-text">
                <strong>{o.label}</strong>
                {o.hint && !compact ? <span className="small muted">{o.hint}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
