import type { Profile } from "./types";

export const EXPERIENCE_OPTIONS: { value: NonNullable<Profile["experience"]>; label: string; hint: string }[] = [
  { value: "new", label: "New to investing", hint: "Just getting started" },
  { value: "some", label: "Some experience", hint: "I know the basics" },
  { value: "experienced", label: "Experienced", hint: "I invest regularly" },
];

export const FOCUS_OPTIONS: { value: NonNullable<Profile["focus"]>; label: string; hint: string }[] = [
  { value: "learn", label: "Learn the basics", hint: "Understand how investing works" },
  { value: "discipline", label: "Build discipline", hint: "Invest with a repeatable process" },
  { value: "growth", label: "Track long-term growth", hint: "Follow a portfolio over time" },
  { value: "explore", label: "Just exploring", hint: "Experiment and have fun" },
];

export const AVATAR_COLORS = ["#0d9488", "#2563eb", "#0ea5e9", "#7c3aed", "#e11d48", "#f59e0b"];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function experienceLabel(value: Profile["experience"]): string {
  return EXPERIENCE_OPTIONS.find((o) => o.value === value)?.label ?? "";
}

export function focusLabel(value: Profile["focus"]): string {
  return FOCUS_OPTIONS.find((o) => o.value === value)?.label ?? "";
}

/** WCAG relative luminance of a #rrggbb colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AVATAR_INK_LIGHT = "#ffffff";
const AVATAR_INK_DARK = "#0b1020";

/** Initials colour for an avatar background: white or near-black, whichever reads better (WCAG AA). */
export function avatarInk(background: string): string {
  return contrastRatio(background, AVATAR_INK_LIGHT) >= contrastRatio(background, AVATAR_INK_DARK) ? AVATAR_INK_LIGHT : AVATAR_INK_DARK;
}
