"use client";

import { useCallback } from "react";
import {
  notificationStore,
  useNotificationStore,
  notifyError,
  notifySuccess,
  notifyWarning,
  notifyInfo,
  type NotificationSeverity,
  type NotificationDisplayMode,
  type NotificationAction,
} from "@/lib/notification-store";

/**
 * React hook for components to push and manage notifications.
 *
 * Usage:
 *   const { notify, notifyError, notifySuccess, store } = useNotification();
 *   notify({ severity: "error", title: "Save failed", source: "config-editor" });
 */
export function useNotification() {
  const store = useNotificationStore();

  const notify = useCallback(
    (opts: {
      type?: string;
      severity: NotificationSeverity;
      title: string;
      detail?: string;
      source?: string;
      displayMode?: NotificationDisplayMode;
      actions?: NotificationAction[];
      autoDismissMs?: number;
      dedupKey?: string;
    }) =>
      notificationStore.push({
        type: opts.type ?? "app",
        ...opts,
      }),
    [],
  );

  return {
    store,
    notify,
    notifyError,
    notifySuccess,
    notifyWarning,
    notifyInfo,
    markRead: notificationStore.markRead,
    markAllRead: notificationStore.markAllRead,
    dismiss: notificationStore.dismiss,
    clear: notificationStore.clear,
  };
}
