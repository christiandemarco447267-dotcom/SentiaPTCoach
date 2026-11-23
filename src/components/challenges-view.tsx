"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Award, CheckCircle2, ClipboardCheck, Layers, NotebookPen, ShieldCheck, Target, TrendingUp } from "lucide-react";
import type { ComponentType } from "react";
import { CHALLENGES, evaluateChallenges, newlyEarned, type ChallengeId } from "@/lib/challenges";
import { formatDate } from "@/lib/format";
import { announceBadge, useApp } from "@/lib/store";
import { goalInfo } from "@/lib/goals";
import { prefersReducedMotion } from "@/lib/celebrate";
import { EmptyState, Loading, Panel, PageHeader } from "./ui";

const ICONS: Record<ChallengeId, ComponentType<{ size?: number }>> = {
  "beat-spy-month": TrendingUp,
  "planned-trades": ClipboardCheck,
  "hold-dip": ShieldCheck,
  "three-sectors": Layers,
  "review-trades": NotebookPen,
};

const LINKS: Record<ChallengeId, { href: string; label: string }> = {
  "beat-spy-month": { href: "/app", label: "See you vs. S&P 500" },
  "planned-trades": { href: "/app/trade", label: "Plan a trade" },
  "hold-dip": { href: "/app/portfolio", label: "Check positions" },
  "three-sectors": { href: "/app/allocate", label: "See your sector mix" },
  "review-trades": { href: "/app/journal", label: "Open the journal" },
};

/** Renders nothing: records a badge (with a toast + confetti) when a challenge completes. */
export function ChallengeWatcher() {
  const { state, summary, actions } = useApp();
  // eslint-disable-next-line react-hooks/purity -- monthly challenges are relative to now
  const progress = useMemo(() => (state ? evaluateChallenges(state, summary, Date.now()) : []), [state, summary]);
  const pending = state ? newlyEarned(state, progress) : [];
  const key = pending.join(",");
  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    try {
      actions.awardBadges(ids);
      ids.forEach(announceBadge);
    } catch {
      // limits: try again on the next change
    }
  }, [key, actions]);
  return null;
}

export function ChallengesView() {
  const { ready, state, summary } = useApp();
  // eslint-disable-next-line react-hooks/purity -- monthly challenges are relative to now
  const progress = useMemo(() => (state ? evaluateChallenges(state, summary, Date.now()) : []), [state, summary]);
  // Badges earned in the last minute get a little pop when this page opens.
  const [mountedAt] = useState(() => Date.now());
  if (!ready || !state) return <Loading />;

  const goal = state.profile.goal;
  const featured = goal ? CHALLENGES.find((c) => c.goal === goal)?.id : undefined;
  const ordered = [...progress].sort((a, b) => Number(b.def.id === featured) - Number(a.def.id === featured));
  const badges = [...state.badges].sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : -1));

  return (
    <div className="stack gap-lg animate-in">
      <PageHeader title="Challenges" subtitle="Small goals that build investing habits. Finish one to earn its badge." />

      {goal ? (
        <Panel className="row gap-sm wrap">
          <Target size={18} />
          <span>
            Your goal: <strong>{goalInfo(goal).label}</strong>. Its challenge is pinned first.
          </span>
          <span className="grow" />
          <Link href="/app/settings" className="small muted tap-link">
            Change goal
          </Link>
        </Panel>
      ) : null}

      <div className="grid grid-2">
        {ordered.map((p) => {
          const Icon = ICONS[p.def.id];
          const link = LINKS[p.def.id];
          const repeat = p.def.id === "beat-spy-month";
          return (
            <Panel key={p.def.id} strong={p.def.id === featured} className="stack gap-sm challenge-card">
              <div className="row between gap-sm">
                <span className="row gap-sm">
                  <span className={`challenge-icon ${p.done ? "done" : ""}`} aria-hidden="true">
                    {p.done && !repeat ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                  </span>
                  <strong>{p.def.title}</strong>
                </span>
                {p.def.id === featured ? <span className="pill pill-primary pill-compact">Your goal</span> : null}
              </div>
              <span className="small muted">{p.def.description}</span>
              <div
                className="progress"
                role="progressbar"
                aria-label={`${p.def.title} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(p.ratio * 100)}
              >
                <span style={{ width: `${Math.round(p.ratio * 100)}%` }} />
              </div>
              <span className="small">{p.detail}</span>
              <div className="row between wrap gap-sm">
                <span className="small dim">
                  {p.earned.length
                    ? `${p.def.badge} badge${repeat && p.earned.length > 1 ? ` ×${p.earned.length}` : ""} · earned ${formatDate(p.earned[p.earned.length - 1].earnedAt)}`
                    : `Badge: ${p.def.badge}`}
                </span>
                <Link href={link.href} className="small link-btn">
                  {link.label}
                </Link>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="stack gap-md">
        <strong className="row gap-sm">
          <Award size={18} /> Your badges
        </strong>
        {badges.length === 0 ? (
          <EmptyState
            icon={<Award size={24} />}
            title="No badges yet"
            hint="Pick a challenge above. You'll get a little celebration when you finish it."
            action={{ label: "Pick a challenge", onClick: () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }) }}
          />
        ) : (
          <div className="badge-shelf">
            {badges.map((b) => {
              const def = CHALLENGES.find((c) => c.id === b.id.split(":")[0]);
              if (!def) return null;
              const Icon = ICONS[def.id];
              const period = b.id.split(":")[1];
              return (
                <div key={b.id} className={`badge-medal${Date.parse(b.earnedAt) > mountedAt - 60_000 ? " badge-earned-fx" : ""}`} title={def.title}>
                  <span className="badge-medal-icon" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <strong className="small">{def.badge}</strong>
                  <span className="small dim">{period ? new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : formatDate(b.earnedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <p className="disclaimer">Paper-trading practice only. Badges reward habits, not investment advice.</p>
    </div>
  );
}
