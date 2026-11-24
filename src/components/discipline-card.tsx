"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { DISCIPLINE_NAME, disciplineChangeWhy, disciplineColor, disciplineScore, disciplineSnapshot, milestoneFor, weakestPart, type DisciplineScore, type DisciplineSnapshot } from "@/lib/discipline";
import { celebrateNow, useApp } from "@/lib/store";
import { Panel } from "./ui";

/** Discipline Score for the current account (null until the store is ready). */
export function useDiscipline(): DisciplineScore | null {
  const { state, summary } = useApp();
  return useMemo(() => {
    if (!state || !summary) return null;
    // eslint-disable-next-line react-hooks/purity -- the 30-day bias window is relative to "now" by design
    return disciplineScore(state, summary, Date.now());
  }, [state, summary]);
}

const scoreColor = disciplineColor;

const WHY_KEY = "sentia.disciplineWhy.v1";
type StoredWhy = { n: number; snap: DisciplineSnapshot; why: string | null };

function readWhy(): StoredWhy | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(WHY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredWhy;
    return typeof v?.n === "number" && v.snap && typeof v.snap.score === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * "Why it changed" after a trade: compares the score with the one recorded at the
 * previous trade count. Waits for quotes so a half-loaded portfolio never explains a fake move.
 */
function useDisciplineWhy(result: DisciplineScore | null): string | null {
  const { state, market } = useApp();
  const hasQuotes = market.quotes.length > 0;
  const n = state ? state.transactions.filter((t) => t.type === "buy" || t.type === "sell").length : 0;
  const why = useMemo(() => {
    if (!result || !hasQuotes) return null;
    const stored = readWhy();
    if (!stored) return null;
    if (stored.n === n) return stored.why;
    return stored.n < n ? disciplineChangeWhy(stored.snap, result) : null;
  }, [result, hasQuotes, n]);
  useEffect(() => {
    if (!result || !hasQuotes) return;
    const stored = readWhy();
    if (stored && stored.n === n) return;
    try {
      window.localStorage.setItem(WHY_KEY, JSON.stringify({ n, snap: disciplineSnapshot(result), why } satisfies StoredWhy));
    } catch {
      // storage full or blocked; the line is optional
    }
  }, [result, hasQuotes, n, why]);
  return why;
}

export function Gauge({ score, size = 132, label = "Discipline" }: { score: number; size?: number; label?: string }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <div className="gauge" style={{ width: size, height: size }} role="img" aria-label={`${label} score ${score} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="gauge-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="gauge-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke={scoreColor(score)}
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 8px ${scoreColor(score)}66)` }}
        />
      </svg>
      <div className="gauge-label">
        <span className="gauge-score">{score}</span>
        <span className="small dim">/ 100</span>
      </div>
    </div>
  );
}

function Parts({ result }: { result: DisciplineScore }) {
  return (
    <div className="discipline-parts">
      {result.parts.map((p) => (
        <div key={p.key} className="stack" style={{ gap: 4 }}>
          <div className="row between small">
            <strong>{p.label}</strong>
            <span className="muted">
              {Math.round(p.points)}/{p.max}
            </span>
          </div>
          <div className="part-bar" aria-hidden="true">
            <span style={{ width: `${(p.points / p.max) * 100}%` }} />
          </div>
          <span className="small dim">{p.detail}</span>
        </div>
      ))}
    </div>
  );
}

/** Prominent Discipline Score card. `compact` (Home) links to the full breakdown on Insights. */
export function DisciplineCard({ compact }: { compact?: boolean }) {
  const result = useDiscipline();
  const why = useDisciplineWhy(result);
  if (!result) return null;
  const weak = weakestPart(result);
  return (
    <Panel strong className="holo stack gap-md">
      <div className="row between wrap gap-sm">
        <strong className="row gap-sm">
          <ShieldCheck size={18} /> {DISCIPLINE_NAME}
        </strong>
        <span className="pill pill-primary">{result.grade}</span>
      </div>
      {why ? (
        <span className="small muted" role="status">
          {why}
        </span>
      ) : null}
      <div className="row wrap gap-lg" style={{ alignItems: "center" }}>
        <Gauge score={result.score} />
        {compact ? (
          <div className="stack gap-sm grow" style={{ minWidth: 220 }}>
            <span className="muted">
              A process score, not a profit score: theses, sizing, diversification, biases avoided and risk tools.
            </span>
            {weak ? (
              <span className="small">
                <strong>Next best step:</strong> {weak.tip}
              </span>
            ) : (
              <span className="small gain">Every part is at or near full marks. Keep it up.</span>
            )}
            <Link href="/app/insights" className="btn btn-sm" style={{ width: "fit-content" }}>
              See breakdown <ArrowRight size={15} />
            </Link>
          </div>
        ) : (
          <Parts result={result} />
        )}
      </div>
      {!compact && weak ? (
        <span className="small muted">
          <strong>Most room to grow:</strong> {weak.label}. {weak.tip}
        </span>
      ) : null}
    </Panel>
  );
}

/**
 * Celebrates crossing a Discipline Score milestone (60 / 75 / 90). The first run
 * only records a baseline, so opening the app never fires a celebration by itself.
 * Waits for live quotes so a half-loaded portfolio can't trigger it.
 */
export function DisciplineWatcher() {
  const { state, market, actions } = useApp();
  const result = useDiscipline();
  const hasQuotes = market.quotes.length > 0;
  const stored = state?.achievements.disciplineMilestone;
  const score = result?.score ?? null;
  useEffect(() => {
    if (!hasQuotes || score === null || stored === undefined) return;
    const reached = milestoneFor(score);
    try {
      if (stored === null) {
        actions.recordDisciplineMilestone(reached);
      } else if (reached > stored) {
        actions.recordDisciplineMilestone(reached);
        celebrateNow("Discipline milestone", `Your Discipline Score reached ${reached}+. Process over luck.`);
      }
    } catch {
      // Store not ready; try on the next change.
    }
  }, [hasQuotes, score, stored, actions]);
  return null;
}
