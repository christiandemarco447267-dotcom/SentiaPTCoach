// Light / dark appearance. A device preference (like font size), so it lives in
// localStorage rather than the synced paper account. Dark is the default; "system"
// follows the OS setting live. An inline script (THEME_INIT_SCRIPT, in the root
// layout) applies it before first paint so there's no flash of the wrong theme.
// Pure (server-safe) parts live here; the React hook is in use-theme.ts.
export const THEME_KEY = "sentia.theme";
export const THEME_PREFS = ["dark", "light", "system"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export type ResolvedTheme = "dark" | "light";

export function parseThemePref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "system" || raw === "dark" ? raw : "dark";
}

export function resolveTheme(pref: ThemePref, systemPrefersLight: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersLight ? "light" : "dark";
  return pref;
}

/** Browser-chrome colour for each theme (address bar / status bar). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { dark: "#070a1c", light: "#f4f2ff" };

/** Runs before React. Kept tiny and dependency-free; mirrors resolveTheme/parseThemePref. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");if(p!=="light"&&p!=="system")p="dark";var l=p==="light"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches);var t=l?"light":"dark";var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?"${THEME_COLORS.light}":"${THEME_COLORS.dark}");}catch(e){}})();`;

