"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellRing, ClipboardCheck, FileSpreadsheet, Moon, Smartphone, Sun, SunMoon } from "lucide-react";
import { downloadText, holdingsCsv, transactionsCsv } from "@/lib/csv";
import { GOAL_OPTIONS } from "@/lib/goals";
import { localDayKey } from "@/lib/market";
import { iosNeedsHomeScreen, notificationSupport, requestNotificationPermission, showSystemNotification, type NotifySupport } from "@/lib/notify";
import { backgroundPushConfigured, disableBackgroundPush, enableBackgroundPush, pushSubscribed, syncPushAlerts } from "@/lib/push";
import { useApp } from "@/lib/store";
import { THEME_PREFS, type ThemePref } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";
import type { PracticeGoal } from "@/lib/types";
import { Panel } from "./ui";

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}

const THEME_LABELS: Record<ThemePref, { label: string; icon: typeof Sun }> = {
  dark: { label: "Dark", icon: Moon },
  light: { label: "Light", icon: Sun },
  system: { label: "System", icon: SunMoon },
};

/** Light / dark / follow the device. Saved on this device. */
export function ThemeSettings() {
  const { pref, theme, setPref } = useTheme();
  return (
    <Panel className="stack gap-md">
      <span className="row gap-sm">
        <SunMoon size={18} /> <strong>Appearance</strong>
      </span>
      <div className="segmented" role="radiogroup" aria-label="Theme" style={{ width: "fit-content" }}>
        {THEME_PREFS.map((p) => {
          const { label, icon: Icon } = THEME_LABELS[p];
          return (
            <button key={p} type="button" role="radio" aria-checked={pref === p} className={pref === p ? "active" : ""} onClick={() => setPref(p)}>
              <Icon size={14} /> {label}
            </button>
          );
        })}
      </div>
      <span className="small muted">
        {pref === "system" ? `Following your device (now ${theme}).` : `${theme === "dark" ? "Dark" : "Light"} mode.`} Saved on this device.
      </span>
    </Panel>
  );
}

/** Pre-trade checklist switch and the practice goal. */
export function HabitSettings() {
  const { state, actions } = useApp();
  if (!state) return null;
  return (
    <Panel className="stack gap-md">
      <span className="row gap-sm">
        <ClipboardCheck size={18} /> <strong>Trading habits</strong>
      </span>
      <div className="switch-row">
        <span className="stack" style={{ gap: 2 }}>
          <span>Pre-trade checklist</span>
          <span className="small muted">Before each market buy, answer 3 quick questions: why, exit plan, and how much you&apos;d risk. Saved with the trade.</span>
        </span>
        <Switch checked={state.settings.preTradeChecklist} label="Pre-trade checklist" onChange={(v) => actions.updateSettings({ preTradeChecklist: v })} />
      </div>
      <div className="field">
        <label htmlFor="settings-goal">Practice goal</label>
        <select
          id="settings-goal"
          className="select"
          value={state.profile.goal ?? ""}
          onChange={(e) => actions.setGoal((e.target.value || null) as PracticeGoal | null)}
        >
          <option value="">No goal set</option>
          {GOAL_OPTIONS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <span className="small dim">
          Pins a matching <Link href="/app/challenges" className="text-link">challenge</Link> and shapes your weekly report tip.
        </span>
      </div>
    </Panel>
  );
}

const noop = () => () => undefined;

function usePermission(): [NotifySupport, (p: NotifySupport) => void] {
  const initial = useSyncExternalStore(noop, notificationSupport, () => "unsupported" as NotifySupport);
  const [override, setOverride] = useState<NotifySupport | null>(null);
  return [override ?? initial, setOverride];
}

/** Phone notifications for price alerts and order fills. */
export function NotificationSettings() {
  const { state, actions } = useApp();
  const [permission, setPermission] = usePermission();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const iosHint = useSyncExternalStore(noop, iosNeedsHomeScreen, () => false);
  const pushReady = backgroundPushConfigured();
  const [bgOn, setBgOn] = useState(false);

  useEffect(() => {
    if (!pushReady) return;
    void pushSubscribed().then(setBgOn);
  }, [pushReady]);

  if (!state) return null;
  const on = state.settings.alertNotifications && permission === "granted";

  const toggle = async (next: boolean) => {
    setMsg("");
    if (!next) {
      actions.updateSettings({ alertNotifications: false });
      return;
    }
    setBusy(true);
    const result = permission === "granted" ? "granted" : await requestNotificationPermission();
    setPermission(result);
    setBusy(false);
    if (result === "granted") {
      actions.updateSettings({ alertNotifications: true });
      setMsg("Notifications on. Try a test below.");
    } else if (result === "denied") {
      setMsg("Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.");
    } else if (result === "unsupported") {
      setMsg(iosHint ? "On iPhone, add Sentia to your Home Screen first (Share → Add to Home Screen), then open it from there." : "This browser doesn't support notifications.");
    }
  };

  const test = async () => {
    const shown = await showSystemNotification({ title: "Sentia test alert", body: "Price alerts will look like this.", tag: "sentia-test" });
    setMsg(shown ? "Test sent. Check your notifications." : "Couldn't show a notification. Check that they're allowed for this site.");
  };

  const toggleBackground = async (next: boolean) => {
    setBusy(true);
    setMsg("");
    try {
      if (next) {
        await enableBackgroundPush(state.alerts);
        setBgOn(true);
        setMsg("Background alerts on. The server checks your active alerts about every 15 minutes.");
      } else {
        await disableBackgroundPush();
        setBgOn(false);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't change background alerts.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="stack gap-md">
      <span className="row gap-sm">
        <Smartphone size={18} /> <strong>Phone notifications</strong>
      </span>
      <div className="switch-row">
        <span className="stack" style={{ gap: 2 }}>
          <span>Price alerts &amp; order fills</span>
          <span className="small muted">
            Shows a notification on this device when a price alert triggers or an order fills. Alerts are checked while Sentia is open or was recently
            open in the background, so if the app is fully closed you&apos;ll see them the next time you open it.
          </span>
        </span>
        <Switch checked={on} label="Price alert notifications" disabled={busy || permission === "unsupported"} onChange={(v) => void toggle(v)} />
      </div>
      {permission === "unsupported" ? (
        <span className="small dim">
          {iosHint
            ? "On iPhone and iPad, notifications work after you add Sentia to your Home Screen (Share → Add to Home Screen) and open it from there (iOS 16.4+)."
            : "This browser doesn't support notifications. In-app alerts still work."}
        </span>
      ) : null}
      {permission === "denied" ? <span className="small loss">Blocked in your browser settings. In-app alerts still work.</span> : null}
      {on ? (
        <button type="button" className="btn btn-sm" style={{ width: "fit-content" }} onClick={() => void test()}>
          <BellRing size={15} /> Send a test notification
        </button>
      ) : null}
      {pushReady && on ? (
        <div className="switch-row">
          <span className="stack" style={{ gap: 2 }}>
            <span>Background alerts (beta)</span>
            <span className="small muted">Lets the Sentia server notify you even when the app is closed. Sends only your active alerts (ticker, above/below, price) to the server.</span>
          </span>
          <Switch
            checked={bgOn}
            label="Background alerts"
            disabled={busy}
            onChange={(v) => void toggleBackground(v)}
          />
        </div>
      ) : null}
      {msg ? (
        <span className="small" role="status">
          {msg}
        </span>
      ) : null}
    </Panel>
  );
}

/** Keeps the server's copy of active alerts current while background alerts are on. Renders nothing. */
export function PushAlertSync() {
  const { state } = useApp();
  const key = state ? state.alerts.filter((a) => a.status === "active").map((a) => `${a.id}:${a.direction}:${a.price}`).join("|") : "";
  useEffect(() => {
    if (!state || !backgroundPushConfigured()) return;
    const t = setTimeout(() => void syncPushAlerts(state.alerts).catch(() => undefined), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the active alerts change
  }, [key]);
  return null;
}

/** Compact status / shortcut for the Watchlist header. */
export function NotificationToggle() {
  const { state, actions } = useApp();
  const [permission, setPermission] = usePermission();
  if (!state || permission === "unsupported") return null;
  if (state.settings.alertNotifications && permission === "granted") {
    return (
      <Link href="/app/settings" className="pill pill-primary" title="Alerts and order fills also show as phone notifications. Change in Settings.">
        <BellRing size={14} /> Phone alerts on
      </Link>
    );
  }
  if (permission === "denied") {
    return (
      <span className="pill" title="Notifications are blocked in your browser settings. In-app alerts still work.">
        <Bell size={14} /> Notifications blocked
      </span>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        void requestNotificationPermission().then((p) => {
          setPermission(p);
          if (p === "granted") actions.updateSettings({ alertNotifications: true });
        });
      }}
    >
      <BellRing size={15} /> Turn on phone alerts
    </button>
  );
}

/** CSV downloads of the ledger and current holdings. */
export function CsvExport({ compact = false }: { compact?: boolean }) {
  const { state, summary } = useApp();
  if (!state) return null;
  const day = localDayKey(new Date());
  const trades = () => downloadText(`sentia-trades-${day}.csv`, transactionsCsv(state));
  const holdings = () => summary && downloadText(`sentia-holdings-${day}.csv`, holdingsCsv(summary));
  const buttons = (
    <span className="row wrap gap-sm">
      <button type="button" className="btn btn-sm" onClick={trades}>
        <FileSpreadsheet size={15} /> Trades CSV
      </button>
      <button type="button" className="btn btn-sm" onClick={holdings} disabled={!summary}>
        <FileSpreadsheet size={15} /> Holdings CSV
      </button>
    </span>
  );
  if (compact) return buttons;
  return (
    <Panel className="stack gap-sm">
      <strong>Spreadsheet export</strong>
      <span className="small muted">Download your trades (with plans and reviews) or current holdings as CSV for Excel, Numbers or Google Sheets.</span>
      {buttons}
    </Panel>
  );
}
