"use client";

import { useEffect } from "react";
import { describeSegments, foldCssVars, readSegments } from "@/lib/viewport-segments";

const VARS = ["--fold-left", "--fold-gap", "--fold-top", "--fold-vgap"];

/**
 * Mirrors the viewport-segments state onto <html data-fold="h|v"> (+ --fold-* variables) for
 * engines that expose the JS API but not the CSS media features. Renders nothing.
 */
export function FoldWatcher() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const info = describeSegments(readSegments());
      for (const v of VARS) root.style.removeProperty(v);
      if (info.mode === "none") {
        delete root.dataset.fold;
        return;
      }
      root.dataset.fold = info.mode === "horizontal" ? "h" : "v";
      for (const [k, val] of Object.entries(foldCssVars(info))) root.style.setProperty(k, val);
    };
    apply();
    window.addEventListener("resize", apply);
    const mq = ["(horizontal-viewport-segments: 2)", "(vertical-viewport-segments: 2)"].map((q) => window.matchMedia(q));
    mq.forEach((m) => m.addEventListener?.("change", apply));
    return () => {
      window.removeEventListener("resize", apply);
      mq.forEach((m) => m.removeEventListener?.("change", apply));
      delete root.dataset.fold;
    };
  }, []);
  return null;
}
