// Foldable / dual-screen helper. Browsers that support the Viewport Segments API expose the
// screen halves as `window.viewport.segments` (and the CSS media features
// horizontal-viewport-segments / vertical-viewport-segments). Older Edge builds on Surface Duo
// used `window.getWindowSegments()` and the `screen-spanning` media feature instead.
// The CSS does the layout; this helper reports the same state to JS (data-fold on <html>, plus
// --fold-* variables) so the layout also works where only the JS API exists.

export type RectLike = { x?: number; y?: number; left?: number; top?: number; width: number; height: number };

export type FoldInfo =
  | { mode: "none" }
  | { mode: "horizontal"; hingeLeft: number; hingeWidth: number; paneWidths: [number, number] }
  | { mode: "vertical"; hingeTop: number; hingeHeight: number; paneHeights: [number, number] };

const left = (r: RectLike) => r.left ?? r.x ?? 0;
const top = (r: RectLike) => r.top ?? r.y ?? 0;

/** Describe two segments as a side-by-side (horizontal) or stacked (vertical) span. */
export function describeSegments(segments: readonly RectLike[] | null | undefined): FoldInfo {
  if (!segments || segments.length !== 2) return { mode: "none" };
  const [a, b] = [...segments].sort((p, q) => left(p) - left(q) || top(p) - top(q));
  const sideBySide = left(b) >= left(a) + a.width - 1 && Math.abs(top(a) - top(b)) < 1;
  if (sideBySide) {
    const hingeLeft = left(a) + a.width;
    return { mode: "horizontal", hingeLeft, hingeWidth: Math.max(0, left(b) - hingeLeft), paneWidths: [a.width, b.width] };
  }
  const stacked = top(b) >= top(a) + a.height - 1;
  if (stacked) {
    const hingeTop = top(a) + a.height;
    return { mode: "vertical", hingeTop, hingeHeight: Math.max(0, top(b) - hingeTop), paneHeights: [a.height, b.height] };
  }
  return { mode: "none" };
}

/** CSS variables for a fold (matches the names polish.css reads). */
export function foldCssVars(info: FoldInfo): Record<string, string> {
  if (info.mode === "horizontal") return { "--fold-left": `${info.hingeLeft}px`, "--fold-gap": `${info.hingeWidth}px` };
  if (info.mode === "vertical") return { "--fold-top": `${info.hingeTop}px`, "--fold-vgap": `${info.hingeHeight}px` };
  return {};
}

/** Small cover screens of folded phones (Galaxy Z Fold cover ≈ 280–320 CSS px). */
export function isCoverScreen(width: number): boolean {
  return width > 0 && width <= 340;
}

/** Unfolded inner screens: 700–900px wide and close to square. */
export function isInnerFoldScreen(width: number, height: number): boolean {
  if (width < 700 || width > 900 || height <= 0) return false;
  const ratio = width / height;
  return ratio >= 0.8 && ratio <= 1.25;
}

type SegmentWindow = {
  viewport?: { segments?: readonly RectLike[] | null };
  getWindowSegments?: () => readonly RectLike[];
};

/** Read the current segments from whichever API the browser offers (null when none). */
export function readSegments(win: SegmentWindow | undefined = typeof window !== "undefined" ? (window as unknown as SegmentWindow) : undefined): readonly RectLike[] | null {
  if (!win) return null;
  try {
    const modern = win.viewport?.segments;
    if (modern && modern.length) return modern;
    if (typeof win.getWindowSegments === "function") return win.getWindowSegments();
  } catch {
    // ignore
  }
  return null;
}
