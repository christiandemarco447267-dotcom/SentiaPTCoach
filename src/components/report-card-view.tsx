"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, CalendarCheck, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { askAiCoach, aiCoachConfigured } from "@/lib/ai-coach";
import { buildCoachContext } from "@/lib/coach-context";
import { formatCurrency, formatPercent } from "@/lib/format";
import { buildWeeklyReport, dueReportWeek, reportPrompt, weekKey, weekLabel } from "@/lib/report-card";
import { useApp } from "@/lib/store";
import { SIM_DISCLAIMER } from "@/lib/site";
import type { ReportTrade, WeeklyReport } from "@/lib/types";
import { EmptyState, Loading, Panel, PageHeader } from "./ui";

// AI tip upgrades already attempted this session (one try per report).
const aiTried = new Set<string>();

/**
 * Renders nothing. Each Monday (or the next time Sentia opens) it writes the report
 * card for the week that just ended, then asks the AI coach for a sharper tip when
 * the Sentia API is configured, keeping the built-in coach's tip if that fails.
 */
export function ReportCardWatcher() {
  const { state, summary, quotes, actions } = useApp();
  const ready = Boolean(state && summary);
  // eslint-disable-next-line react-hooks/purity -- the due week is relative to now
  const due = state ? dueReportWeek(state, Date.now()) : null;

  useEffect(() => {
    if (!ready || !due || !state) return;
    const draft = buildWeeklyReport(state, due);
    const report: WeeklyReport = { ...draft, createdAt: new Date().toISOString() };
    try {
      actions.saveReport(report);
    } catch {
      return;
    }
    if (!aiCoachConfigured() || aiTried.has(due) || !summary) return;
    aiTried.add(due);
    const context = buildCoachContext({ state, summary, quotes });
    askAiCoach(reportPrompt(report), context, () => undefined)
      .then((text) => {
        const tip = text.replace(/\s*Educational only[^\n]*$/i, "").trim();
        if (tip.length >= 10) actions.setReportTip(due, tip, "ai");
      })
      .catch(() => undefined); // keep the built-in coach's tip
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per due week
  }, [ready, due]);

  return null;
}

function TradeLine({ label, trade, icon }: { label: string; trade: ReportTrade | null; icon: React.ReactNode }) {
  return (
    <div className="report-trade">
      <span className="small muted row gap-sm">
        {icon} {label}
      </span>
      {trade ? (
        <strong className={trade.gain >= 0 ? "gain" : "loss"}>
          {trade.symbol} {formatCurrency(trade.gain)}
          {trade.gainPct !== null ? ` (${formatPercent(trade.gainPct, true)})` : ""}
        </strong>
      ) : (
        <span className="dim">No closed trades</span>
      )}
    </div>
  );
}

export function ReportCard({ report, preview = false }: { report: Pick<WeeklyReport, "week" | "grade" | "score" | "returnPct" | "spyReturnPct" | "trades" | "best" | "worst" | "notes" | "tip" | "tipSource">; preview?: boolean }) {
  const diff = report.returnPct !== null && report.spyReturnPct !== null ? report.returnPct - report.spyReturnPct : null;
  return (
    <Panel strong className="stack gap-md report-card">
      <div className="row between wrap gap-sm">
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">{preview ? "This week so far" : "Week of"}</span>
          <strong style={{ fontSize: "1.15rem" }}>{weekLabel(report.week)}</strong>
        </div>
        <div className={`grade-badge grade-${report.grade}`} aria-label={`Grade ${report.grade}, ${report.score} out of 100`}>
          <span className="grade-letter">{report.grade}</span>
          <span className="grade-score">{report.score}/100</span>
        </div>
      </div>

      <div className="bench-stats bench-stats-4">
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">Your return</span>
          <strong className={report.returnPct === null ? "dim" : report.returnPct >= 0 ? "gain" : "loss"}>{report.returnPct === null ? "—" : formatPercent(report.returnPct, true)}</strong>
        </div>
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">S&amp;P 500 (SPY)</span>
          <strong className={report.spyReturnPct === null ? "dim" : report.spyReturnPct >= 0 ? "gain" : "loss"}>{report.spyReturnPct === null ? "—" : formatPercent(report.spyReturnPct, true)}</strong>
        </div>
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">vs benchmark</span>
          <strong className={diff === null ? "dim" : diff >= 0 ? "gain" : "loss"}>{diff === null ? "—" : `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)} pts`}</strong>
        </div>
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">Trades</span>
          <strong>{report.trades}</strong>
        </div>
      </div>

      <div className="grid grid-2">
        <TradeLine label="Best trade" trade={report.best} icon={<TrendingUp size={14} />} />
        <TradeLine label="Worst trade" trade={report.worst} icon={<TrendingDown size={14} />} />
      </div>

      <div className="stack gap-sm">
        <span className="eyebrow">Discipline notes</span>
        <ul className="report-notes">
          {report.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>

      <div className="nudge report-tip" role="note">
        {report.tipSource === "ai" ? <Bot size={16} /> : <Lightbulb size={16} />}
        <span>
          <strong>Coach tip{report.tipSource === "ai" ? " (AI coach)" : ""}:</strong> {report.tip}
        </span>
      </div>
    </Panel>
  );
}

export function ReportCardView() {
  const { ready, state } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/purity -- the "this week" preview is relative to now
  const thisWeek = weekKey(Date.now());
  const preview = useMemo(() => (state ? buildWeeklyReport(state, thisWeek) : null), [state, thisWeek]);

  if (!ready || !state) return <Loading />;
  const reports = state.reports;
  const current = reports.find((r) => r.week === selected) ?? reports[0] ?? null;

  return (
    <div className="stack gap-lg animate-in">
      <PageHeader
        title="Weekly report card"
        subtitle="Every Monday: a grade, your best and worst trade, how you did against the S&P 500, and one thing to work on."
      />

      {current ? (
        <ReportCard report={current} />
      ) : (
        <EmptyState
          title="Your first report card arrives next Monday"
          hint="It grades the week that just ended. Meanwhile, here's how this week is shaping up."
        />
      )}

      {preview ? (
        <details className="panel report-preview" open={!current}>
          <summary className="row between">
            <span className="row gap-sm">
              <CalendarCheck size={18} /> <strong>This week so far</strong>
            </span>
            <span className="small muted">Preview: final grade on Monday</span>
          </summary>
          <div style={{ marginTop: 14 }}>
            <ReportCard report={preview} preview />
          </div>
        </details>
      ) : null}

      {reports.length > 1 ? (
        <Panel className="stack gap-md">
          <strong>History</strong>
          <div className="list">
            {reports.map((r) => (
              <button
                key={r.week}
                type="button"
                className="list-row report-row"
                aria-pressed={current?.week === r.week}
                onClick={() => {
                  setSelected(r.week);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <span className={`grade-chip grade-${r.grade}`}>{r.grade}</span>
                <span className="grow stack" style={{ gap: 2, textAlign: "left" }}>
                  <strong>{weekLabel(r.week)}</strong>
                  <span className="small dim">
                    {r.trades} trade{r.trades === 1 ? "" : "s"}
                    {r.returnPct !== null && r.spyReturnPct !== null ? ` · you ${formatPercent(r.returnPct, true)} vs SPY ${formatPercent(r.spyReturnPct, true)}` : ""}
                  </span>
                </span>
                <span className="small muted">{r.score}/100</span>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel className="stack gap-sm">
        <strong>How the grade works</strong>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>60 points for process: buys with a written plan (25), closed trades reviewed (15), no bias flags (20).</li>
          <li>40 points for results: 20 for matching the S&amp;P 500, up to ±20 more for beating or trailing it.</li>
          <li>A: 90+, B: 80+, C: 70+, D: 60+. Very busy weeks (over 15 trades) lose a few points.</li>
          <li>
            The tip comes from the built-in coach{aiCoachConfigured() ? ", or the AI coach when it's reachable" : ""}. Ask follow-ups in{" "}
            <Link href="/app/coach" className="text-link">
              Ask Sentia
            </Link>.
          </li>
        </ul>
      </Panel>
      <p className="disclaimer">{SIM_DISCLAIMER}</p>
    </div>
  );
}
