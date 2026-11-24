// Pure helpers for the "pick up to 3" setup questions (v6). Unit-tested.
import { MAX_SETUP_PICKS } from "./types";

/** Toggle one option: removes it when picked, adds it when there's room, otherwise leaves the list alone. */
export function togglePick<T>(selected: readonly T[], value: T, max = MAX_SETUP_PICKS): T[] {
  if (selected.includes(value)) return selected.filter((v) => v !== value);
  if (selected.length >= max) return [...selected];
  return [...selected, value];
}

/** De-duplicate, keep only allowed values, and cap at `max` (first picks win). */
export function cleanPicks<T>(list: readonly unknown[] | null | undefined, allowed: readonly T[], max = MAX_SETUP_PICKS): T[] {
  const out: T[] = [];
  for (const v of list ?? []) {
    if ((allowed as readonly unknown[]).includes(v) && !out.includes(v as T)) out.push(v as T);
    if (out.length >= max) break;
  }
  return out;
}

/** Is an unpicked option locked because the limit is reached? */
export function pickLocked<T>(selected: readonly T[], value: T, max = MAX_SETUP_PICKS): boolean {
  return !selected.includes(value) && selected.length >= max;
}

/** "2 of 3" */
export function pickCounter(count: number, max = MAX_SETUP_PICKS): string {
  return `${Math.min(count, max)} of ${max} picked`;
}
