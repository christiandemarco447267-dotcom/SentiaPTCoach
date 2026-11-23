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
