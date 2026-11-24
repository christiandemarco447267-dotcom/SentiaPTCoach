// System (phone / desktop) notifications for price alerts and order fills.
// Shown through the service worker (registration.showNotification), which is what
// Android Chrome and iOS home-screen web apps require; falls back to `new Notification`.
// Honest limit: these fire while Sentia is open or still running in the background.
// Alerts while the app is fully closed need Web Push (see push.ts, off by default).
import { assetPath } from "./asset";

export type NotifySupport = "unsupported" | "default" | "granted" | "denied";

export function notificationSupport(): NotifySupport {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotifySupport;
}

/** iPhone/iPad Safari only allows web notifications for apps added to the Home Screen (iOS 16.4+). */
export function iosNeedsHomeScreen(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function requestNotificationPermission(): Promise<NotifySupport> {
  if (notificationSupport() === "unsupported") return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result as NotifySupport;
  } catch {
    return notificationSupport();
  }
}

export type SystemNotice = { title: string; body: string; tag?: string; url?: string };

/** Show a notification. Resolves true when one was shown. Never throws. */
export async function showSystemNotification(notice: SystemNotice): Promise<boolean> {
  if (notificationSupport() !== "granted") return false;
  const options: NotificationOptions = {
    body: notice.body,
    tag: notice.tag,
    icon: assetPath("/icons/icon-192.png"),
    badge: assetPath("/icons/icon-192.png"),
    data: { url: notice.url ?? assetPath("/app/") },
  };
  try {
    const reg = typeof navigator !== "undefined" && "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(notice.title, options);
      return true;
    }
  } catch {
    // fall through to the page-level API
  }
  try {
    new Notification(notice.title, options);
    return true;
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
    return false;
  }
}

export type AlertsHelp = {
  /** Nothing to explain (notifications on, or push configured and granted). */
  hidden: boolean;
  title: string;
  body: string;
  /** Show the "Enable notifications" button (the browser can still ask). */
  canRequest: boolean;
  steps: string[];
};

/**
 * What the Watchlist says about alerts, by notification state. Honest about the limit:
 * without Web Push, alerts are checked only while Sentia is open (or in the background).
 */
export function alertsHelp(input: { permission: NotifySupport; iosHomeScreen: boolean; pushConfigured: boolean; enabled: boolean }): AlertsHelp {
  const { permission, iosHomeScreen, pushConfigured, enabled } = input;
  const whenOpen = pushConfigured
    ? "With notifications on, alerts can reach you even when Sentia is closed."
    : "Price alerts are checked only while Sentia is open (or still running in the background). They can't fire when the app is fully closed.";
  if (iosHomeScreen) {
    return {
      hidden: false,
      title: "Alerts on iPhone and iPad need Sentia on your Home Screen",
      body: `Safari only allows notifications for web apps added to the Home Screen (iOS 16.4 or later). ${whenOpen}`,
      canRequest: false,
      steps: ["Tap the Share button in Safari.", "Choose “Add to Home Screen”, then Add.", "Open Sentia from the new icon and tap “Enable notifications” here."],
    };
  }
  if (permission === "granted" && enabled) return { hidden: true, title: "", body: "", canRequest: false, steps: [] };
  if (permission === "unsupported") {
    return { hidden: false, title: "In-app alerts only on this browser", body: `This browser doesn't support notifications, so alerts show inside Sentia. ${whenOpen}`, canRequest: false, steps: [] };
  }
  if (permission === "denied") {
    return {
      hidden: false,
      title: "Notifications are blocked for Sentia",
      body: `Alerts still show inside Sentia. ${whenOpen}`,
      canRequest: false,
      steps: [
        "Open your browser's site settings for this page (the icon left of the address bar).",
        "Set Notifications to Allow, then reload Sentia.",
        "On iPhone: Settings → Notifications → Sentia (Home Screen app) → Allow Notifications.",
      ],
    };
  }
  return {
    hidden: false,
    title: permission === "granted" ? "Phone notifications are off" : "Get alerts as notifications",
    body: whenOpen,
    canRequest: true,
    steps: [],
  };
}
