"use client";

// Client side of the light/dark preference: read/write localStorage, apply to <html>,
// follow the OS when the preference is "system". Pure helpers live in theme.ts.
import { useSyncExternalStore } from "react";
import { parseThemePref, resolveTheme, THEME_COLORS, THEME_KEY, type ResolvedTheme, type ThemePref } from "./theme";

const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

function systemLight(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Apply the theme to <html> (data-theme + color-scheme + theme-color meta). */
export function applyTheme(pref: ThemePref = readPref()) {
  if (typeof document === "undefined") return;
  const theme = resolveTheme(pref, systemLight());
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "dark") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: still apply for this page view.
  }
  applyTheme(pref);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const onSystem = () => {
    if (readPref() === "system") applyTheme("system");
    listener();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme();
      listener();
    }
  };
  mq?.addEventListener?.("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    mq?.removeEventListener?.("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}

/** Current preference and the theme it resolves to right now. */
export function useTheme(): { pref: ThemePref; theme: ResolvedTheme; setPref: (p: ThemePref) => void } {
  const pref = useSyncExternalStore(subscribe, readPref, () => "dark" as ThemePref);
  const light = useSyncExternalStore(subscribe, systemLight, () => false);
  return { pref, theme: resolveTheme(pref, light), setPref: setThemePref };
}
