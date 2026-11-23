"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Lock, LogOut, Medal, Share2, Users } from "lucide-react";
import { assetPath } from "@/lib/asset";
import { friendlyAuthError } from "@/lib/auth-helpers";
import { useAuth } from "@/lib/auth";
import { trailingReturnPct } from "@/lib/benchmark";
import { formatPercent } from "@/lib/format";
import { getLeague, createLeague, joinLeague, leaveLeague, publishMember, watchMembers } from "@/lib/league-store";
import { buildMemberSummary, normalizeLeagueCode, rankLeague, type LeagueMember, type MemberSummary } from "@/lib/leagues";
import { useApp } from "@/lib/store";
import { useDiscipline } from "./discipline-card";
import { EmptyState, Loading, Panel, PageHeader } from "./ui";

/** "5 min ago" for leaderboard freshness. */
export function updatedAgo(ms: number | undefined, now: number): string {
  if (!ms) return "";
  const mins = Math.max(0, Math.round((now - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Link that opens Leagues with the join code filled in. */
function inviteLink(code: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${assetPath("/app/leagues/")}?join=${code}`;
}

function LockedState({ configured, joinCode }: { configured: boolean; joinCode: string | null }) {
  return (
    <Panel strong className="stack gap-md locked-panel">
      <span className="lock-icon">
        <Lock size={24} />
      </span>
      <strong style={{ fontSize: "1.15rem" }}>Friend leagues need a Sentia account</strong>
      <span className="muted">
        Leagues let friends compare <strong>Discipline Scores</strong> (and monthly return as a tiebreaker) by sharing a
        six-letter code. Only a tiny summary is shared: your display name, score and 30-day return — never your holdings,
        trades or balances.
      </span>
      {configured ? (
        <div className="stack gap-sm">
          {joinCode ? (
            <span className="pill pill-primary" style={{ width: "fit-content" }}>
              You were invited to league {joinCode}. Sign in to join.
            </span>
          ) : null}
          <div className="row wrap gap-sm">
            <Link href="/signup" className="btn btn-primary">
              Create an account
            </Link>
            <Link href={`/signin?next=${encodeURIComponent(joinCode ? `/app/leagues?join=${joinCode}` : "/app/leagues")}`} className="btn">
              Sign in
            </Link>
          </div>
          <span className="small dim">Accounts need a verified email. Your paper portfolio comes with you when you sign up.</span>
        </div>
      ) : (
        <span className="small dim">
          This demo build runs without accounts (guest mode only), so leagues are unavailable here. They switch on
          automatically when Sentia is deployed with Firebase configured.
        </span>
      )}
    </Panel>
  );
}

export function LeaguesView() {
  const { configured, user } = useAuth();
  const { ready, state, sync } = useApp();
  const params = useSearchParams();
  const joinCode = normalizeLeagueCode(params.get("join") ?? "");
  if (!ready || !state) return <Loading />;
  const signedIn = configured && user && sync.mode === "cloud";
  return (
    <div className="stack gap-lg animate-in">
      <PageHeader title="Friend leagues" subtitle="Compete on process, not just profit. Ranked by Discipline Score." />
      {signedIn ? <Leagues uid={user.uid} joinCode={joinCode} /> : <LockedState configured={configured} joinCode={joinCode} />}
      <p className="disclaimer">Paper-trading results only. Leaderboards are for fun and learning, not investment advice.</p>
    </div>
  );
}

function Leagues({ uid, joinCode }: { uid: string; joinCode: string | null }) {
  const { state, actions } = useApp();
  const discipline = useDiscipline();
  const [name, setName] = useState("");
  const [code, setCode] = useState(joinCode && !(state?.leagues ?? []).includes(joinCode) ? joinCode : "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lastPublished = useRef("");

  const summary: MemberSummary | null = useMemo(() => {
    if (!state || !discipline) return null;
    // eslint-disable-next-line react-hooks/purity -- the 30-day window is relative to now
    const ret = trailingReturnPct(state.snapshots, Date.now(), 30);
    return buildMemberSummary({ displayName: state.profileName || "Investor", disciplineScore: discipline.score, monthlyReturnPct: ret });
  }, [state, discipline]);

  const codes = state?.leagues ?? [];
  const codesKey = codes.join(",");

  // Keep my public summary fresh in every league I'm in (only when it changes).
  useEffect(() => {
    if (!summary || !codesKey) return;
    const key = `${codesKey}|${JSON.stringify(summary)}`;
    if (key === lastPublished.current) return;
    lastPublished.current = key;
    for (const c of codesKey.split(",")) void publishMember(c, uid, summary).catch(() => undefined);
  }, [summary, codesKey, uid]);

  if (!summary) return <Loading />;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await fn() });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyAuthError(err, err instanceof Error ? err.message : "Something went wrong.") });
    } finally {
      setBusy(false);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      const league = await createLeague(uid, name, summary);
      actions.rememberLeague(league.code);
      setName("");
      return `League created. Share the code ${league.code} with friends.`;
    });
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeLeagueCode(code);
    if (!normalized) return setMessage({ tone: "error", text: "League codes are 6 letters/numbers, e.g. K7Q2MX." });
    void run(async () => {
      const league = await joinLeague(normalized, uid, summary);
      actions.rememberLeague(league.code);
      setCode("");
      return `Joined “${league.name}”.`;
    });
  };

  return (
    <>
      <Panel className="stack gap-md">
        <div className="grid grid-2">
          <form className="stack gap-sm" onSubmit={create}>
            <label htmlFor="league-name">
              <strong>Create a league</strong>
            </label>
            <div className="row gap-sm">
              <input id="league-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Weekend Warriors" />
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                Create
              </button>
            </div>
          </form>
          <form className="stack gap-sm" onSubmit={join}>
            <label htmlFor="league-code">
              <strong>Join with a code</strong>
            </label>
            <div className="row gap-sm">
              <input id="league-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="K7Q2MX" autoComplete="off" />
              <button type="submit" className="btn" disabled={busy || !code.trim()}>
                Join
              </button>
            </div>
          </form>
        </div>
        {message ? <span className={message.tone === "ok" ? "form-ok" : "form-error"}>{message.text}</span> : null}
        <span className="small dim">
          You share: “{summary.displayName}”, Discipline Score {summary.disciplineScore}, 30-day return{" "}
          {summary.monthlyReturnPct === null ? "— (not enough history yet)" : formatPercent(summary.monthlyReturnPct, true)}. Change your
          display name in Settings.
        </span>
      </Panel>

      {codes.length === 0 ? (
        <EmptyState title="You're not in a league yet" hint="Create one and share the code, or join a friend's." />
      ) : (
        codes.map((c) => <LeagueBoard key={c} code={c} uid={uid} onLeave={() => actions.forgetLeague(c)} />)
      )}
      {codes.length ? (
        <span className="small dim">
          Scores refresh automatically while you have Sentia open. Ranking: Discipline Score first, then 30-day return.
        </span>
      ) : null}
    </>
  );
}

function LeagueBoard({ code, uid, onLeave }: { code: string; uid: string; onLeave: () => void }) {
  const [members, setMembers] = useState<LeagueMember[] | null>(null);
  const [leagueName, setLeagueName] = useState(code);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"" | "code" | "link">("");
  // eslint-disable-next-line react-hooks/purity -- "updated x min ago" is relative to now
  const now = Date.now();

  const share = async () => {
    const url = inviteLink(code);
    const text = `Join my Sentia paper-trading league “${leagueName}” with code ${code}.`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Sentia league invite", text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied("link");
    } catch {
      // Share sheet dismissed or clipboard blocked: the code stays visible.
    }
  };

  useEffect(() => {
    let alive = true;
    getLeague(code)
      .then((l) => alive && l && setLeagueName(l.name))
      .catch(() => undefined);
    const stop = watchMembers(
      code,
      (list) => alive && setMembers(list),
      (e) =>
        alive &&
        setError(
          String((e as { code?: string })?.code ?? "").includes("permission-denied")
            ? "You're not a member of this league any more (or your email isn't verified yet). Join again with its code."
            : "Couldn't load this league. Check your connection; it will retry when you come back.",
        ),
    );
    return () => {
      alive = false;
      stop();
    };
  }, [code]);

  const ranked = members ? rankLeague(members) : [];

  return (
    <Panel strong className="stack gap-md">
      <div className="row between wrap gap-sm">
        <strong className="row gap-sm">
          <Users size={18} /> {leagueName}
        </strong>
        <div className="row gap-sm">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              // Clipboard can be denied (permissions / insecure context); the code stays visible on the button.
              void navigator.clipboard?.writeText(code).then(() => setCopied("code"), () => undefined);
            }}
            title="Copy invite code"
          >
            <Copy size={14} /> {copied === "code" ? "Copied" : code}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void share()} title="Share an invite link">
            <Share2 size={14} /> {copied === "link" ? "Link copied" : "Invite"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => {
              if (!confirm("Leave this league? Your summary will be removed from its leaderboard.")) return;
              void leaveLeague(code, uid).finally(onLeave);
            }}
          >
            <LogOut size={14} /> Leave
          </button>
        </div>
      </div>
      {error ? <span className="form-error">{error}</span> : null}
      {!members && !error ? <Loading label="Loading leaderboard…" /> : null}
      {members && members.length === 1 ? (
        <span className="small muted">Just you so far. Tap Invite to send friends the link, or share the code {code}.</span>
      ) : null}
      {members ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Discipline</th>
                <th style={{ textAlign: "right" }}>30-day return</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((m) => (
                <tr key={m.uid}>
                  <td>{m.rank <= 3 ? <Medal size={16} aria-label={`Rank ${m.rank}`} className={`medal medal-${m.rank}`} /> : m.rank}</td>
                  <td>
                    {m.displayName}
                    {m.uid === uid ? <span className="pill pill-primary pill-compact" style={{ marginLeft: 8 }}>You</span> : null}
                    {m.updatedAt ? <span className="small dim" style={{ display: "block" }}>updated {updatedAgo(m.updatedAt, now)}</span> : null}
                  </td>
                  <td>
                    <strong>{m.disciplineScore}</strong>
                  </td>
                  <td style={{ textAlign: "right" }} className={m.monthlyReturnPct === null ? "dim" : m.monthlyReturnPct >= 0 ? "gain" : "loss"}>
                    {m.monthlyReturnPct === null ? "—" : formatPercent(m.monthlyReturnPct, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}
