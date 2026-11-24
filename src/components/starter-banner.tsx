"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { freshStartWording } from "@/lib/format";
import { freshStartAmount, showStarterNotice } from "@/lib/storage";
import { useApp } from "@/lib/store";
import { Dialog } from "./dialog";

/** "This is a sample starter portfolio" note with Keep / Start fresh (confirmed). Dashboard and Portfolio. */
export function StarterBanner() {
  const { state, summary, actions } = useApp();
  // The amount is frozen when the confirm dialog opens, so what you confirm is what you get.
  const [confirming, setConfirming] = useState<number | null>(null);
  if (!state || !showStarterNotice(state)) return null;
  const live = freshStartAmount(state, summary?.total);
  const amount = confirming ?? live;
  const wording = freshStartWording(amount, summary?.total);
  const cash = wording.cash;
  return (
    <>
      <div className="panel starter-banner row wrap gap-md" role="region" aria-label="Sample starter portfolio">
        <span className="tour-icon" aria-hidden="true">
          <Sparkles size={20} />
        </span>
        <div className="stack grow" style={{ gap: 2, minWidth: 220 }}>
          <strong>This is a sample starter portfolio</strong>
          <span className="small muted">
            Sentia started you with VTI, VXUS and BND plus example theses so every screen has something to show. Keep it, or start
            fresh with {wording.phrase} and build your own.
          </span>
        </div>
        <div className="row wrap gap-sm banner-actions">
          <button type="button" className="btn" onClick={() => actions.dismissStarter()}>
            Keep sample
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setConfirming(live)}>
            Start fresh
          </button>
        </div>
        <button type="button" className="btn btn-icon btn-sm starter-close" onClick={() => actions.dismissStarter()} aria-label="Dismiss starter portfolio note">
          <X size={16} />
        </button>
      </div>
      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} labelledBy="fresh-title" describedBy="fresh-desc">
        <h2 id="fresh-title" style={{ fontSize: "1.25rem", margin: 0 }}>
          Start fresh with {cash}?
        </h2>
        <p id="fresh-desc" className="small muted" style={{ margin: 0 }}>
          This removes the sample positions, their theses, your trade history, open orders, report cards and the performance
          chart, and leaves {cash} in cash. Your profile, settings, watchlist, alerts and badges stay. This can&apos;t be undone.
        </p>
        <div className="row between wrap gap-sm banner-actions">
          <button type="button" className="btn" onClick={() => setConfirming(null)} data-autofocus>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              actions.startFresh(amount);
              setConfirming(null);
            }}
          >
            Start fresh
          </button>
        </div>
      </Dialog>
    </>
  );
}
