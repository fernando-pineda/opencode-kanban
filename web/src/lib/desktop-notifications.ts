/**
 * Desktop Notifications Utility
 *
 * Provides browser push notifications via the Web Notification API.
 * Used to alert users when a kanban card finishes its work iteration.
 */

// ── Permission Management ────────────────────────────────────────────────

/**
 * Request notification permission from the browser.
 * Safe to call multiple times — returns current state if already decided.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
}

/**
 * Returns true if the browser supports notifications and permission is granted.
 */
export function shouldShowDesktopNotifications(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}

/**
 * Returns the current permission state, or "unsupported" if the API is missing.
 */
export function getNotificationPermissionStatus(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// ── Notification Display ─────────────────────────────────────────────────

export interface DesktopNotificationOptions {
  title: string;
  body: string;
  /** Prevents duplicate notifications with the same tag */
  tag?: string;
  /** Session ID for navigation on click */
  sessionId?: string;
  /** Board ID for navigation on click */
  boardId?: number;
  /** Custom click handler — overrides default navigation */
  onClick?: () => void;
}

/**
 * Show a desktop notification if permissions are granted.
 * Automatically focuses the window and closes the notification on click.
 */
export function showDesktopNotification(options: DesktopNotificationOptions): void {
  if (!shouldShowDesktopNotifications()) return;

  const notification = new Notification(options.title, {
    body: options.body,
    icon: "/favicon.ico",
    tag: options.tag || `kanban-${options.sessionId}`,
    silent: false,
  });

  notification.onclick = () => {
    window.focus();
    if (options.onClick) {
      options.onClick();
    }
    notification.close();
  };

  // Auto-close after 10 seconds
  setTimeout(() => notification.close(), 10_000);
}

// ── Card-Completed Helper ────────────────────────────────────────────────

/**
 * Convenience function: show a desktop notification when a card finishes.
 * This is the primary integration point for the notifications hook.
 */
export function notifyCardCompleted(options: {
  sessionId: string;
  title?: string;
  boardId?: number;
  onClick?: () => void;
}): void {
  showDesktopNotification({
    title: "Task completed",
    body: options.title || `Session ${options.sessionId} finished`,
    tag: `kanban-${options.sessionId}`,
    sessionId: options.sessionId,
    boardId: options.boardId,
    onClick: options.onClick,
  });
}
