"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CheckCircle, Clock, AlertCircle, AlertTriangle, Info, Zap, Terminal, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartPoll } from "@/hooks/use-smart-poll";
import {
  notificationStore,
  type AppNotification,
} from "@/lib/notification-store";

type NotificationEvent = {
  id: string;
  type: "cron" | "session" | "log" | "system" | "pairing" | "usage-alert";
  timestamp: number;
  title: string;
  detail?: string;
  status?: "ok" | "error" | "info" | "warning";
  source?: string;
};

type PairingResponse = {
  dm?: Array<{
    channel: string;
    code: string;
    account?: string;
    senderId?: string;
    senderName?: string;
    message?: string;
    createdAt?: string;
  }>;
  devices?: Array<{
    requestId: string;
    displayName?: string;
    platform?: string;
    role?: string;
    createdAtMs?: number;
  }>;
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cron: Clock,
  session: Zap,
  log: Terminal,
  system: Radio,
  pairing: Bell,
  "usage-alert": AlertTriangle,
};

const TYPE_ROUTE: Record<string, string> = {
  cron: "/cron",
  session: "/sessions",
  log: "/logs",
  system: "/activity",
  pairing: "/channels",
  "usage-alert": "/usage",
};

const TYPE_QUERY_PARAM: Record<string, string> = {
  cron: "job",
  session: "id",
};

/** Merged display item for the bell panel. */
type DisplayItem = {
  id: string;
  type: string;
  timestamp: number;
  title: string;
  detail?: string;
  status: string;
  source?: string;
  read: boolean;
  /** If from the notification store, the original notification. */
  storeNotification?: AppNotification;
  /** If from polling, the original event. */
  polledEvent?: NotificationEvent;
};

function getBellNotifications() {
  return notificationStore.getBellNotifications();
}
const emptyBell: AppNotification[] = [];

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [lastSeenTs, setLastSeenTs] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = localStorage.getItem("notif_last_seen");
    return stored ? Number(stored) : 0;
  });
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("notif_read_ids");
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const slowBackgroundPolling = !open;

  // Subscribe to store-pushed bell notifications
  const storeNotifications = useSyncExternalStore(
    notificationStore.subscribe,
    getBellNotifications,
    () => emptyBell,
  );

  // Persist readIds to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem("notif_read_ids", JSON.stringify([...readIds]));
    } catch { /* ignore */ }
  }, [readIds]);

  const fetchNotifications = useCallback(async () => {
    try {
      const [activityRes, pairingRes, alertsRes] = await Promise.all([
        fetch("/api/activity", { cache: "no-store", signal: AbortSignal.timeout(6000) })
          .catch(() => new Response("[]", { status: 200 })),
        fetch("/api/pairing", { cache: "no-store", signal: AbortSignal.timeout(6000) }),
        fetch("/api/usage/alerts?poll=1", { cache: "no-store", signal: AbortSignal.timeout(6000) }).catch(() => null),
      ]);

      const activityData = activityRes.ok ? ((await activityRes.json()) as NotificationEvent[]) : [];
      const pairingData = pairingRes.ok ? ((await pairingRes.json()) as PairingResponse) : {};
      const alertsData = alertsRes?.ok
        ? ((await alertsRes.json()) as { alerts?: Array<{ id: string; message: string; firedAt?: number }> })
        : {};

      // Only show actionable activity events (errors and warnings).
      const actionable = (Array.isArray(activityData) ? activityData : []).filter(
        (e) => e.status === "error" || e.status === "warning"
      );

      const pairingEvents: NotificationEvent[] = [
        ...((pairingData.dm || []).map((req) => ({
          id: `pairing:dm:${req.channel}:${req.account || "default"}:${req.code}`,
          type: "pairing" as const,
          timestamp: req.createdAt ? new Date(req.createdAt).getTime() || Date.now() : Date.now(),
          title: `${req.channel} pairing request`,
          detail:
            req.senderName || req.senderId
              ? `${req.senderName || req.senderId}${req.message ? `: ${req.message}` : ""}`
              : "New sender waiting for approval",
          status: "warning" as const,
          source: req.channel,
        }))),
        ...((pairingData.devices || []).map((req) => ({
          id: `pairing:device:${req.requestId}`,
          type: "pairing" as const,
          timestamp: req.createdAtMs || Date.now(),
          title: "Device pairing request",
          detail: req.displayName || req.platform || req.role || "A device is waiting for approval",
          status: "warning" as const,
          source: req.requestId,
        }))),
      ];

      // Usage alert firings → notification events + desktop notification
      const alertEvents: NotificationEvent[] = (alertsData.alerts || []).map((alert) => {
        // Fire a desktop notification for each new alert
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification("Usage Alert", {
              body: alert.message,
              tag: `usage-alert:${alert.id}`,
              icon: "/favicon.ico",
            });
          } catch { /* ignore */ }
        }
        return {
          id: `usage-alert:${alert.id}`,
          type: "usage-alert" as const,
          timestamp: alert.firedAt || Date.now(),
          title: "Usage alert triggered",
          detail: alert.message,
          status: "warning" as const,
          source: alert.id,
        };
      });

      const merged = [...alertEvents, ...pairingEvents, ...actionable]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);

      setEvents(merged);
    } catch {
      /* ignore */
    }
  }, [open]);

  useSmartPoll(fetchNotifications, { intervalMs: slowBackgroundPolling ? 60_000 : 20_000 });

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Merge polled events + store notifications into unified display list
  const displayItems = useMemo((): DisplayItem[] => {
    const polledItems: DisplayItem[] = events.map((e) => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp,
      title: e.title,
      detail: e.detail,
      status: e.status || "info",
      source: e.source,
      read: e.timestamp <= lastSeenTs || readIds.has(e.id),
      polledEvent: e,
    }));

    const storeItems: DisplayItem[] = storeNotifications.map((n) => ({
      id: n.id,
      type: n.type,
      timestamp: n.timestamp,
      title: n.title,
      detail: n.detail,
      status: n.severity,
      source: n.source,
      read: n.read,
      storeNotification: n,
    }));

    // Dedup by id, then sort by timestamp desc
    const byId = new Map<string, DisplayItem>();
    for (const item of [...polledItems, ...storeItems]) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 25);
  }, [events, storeNotifications, lastSeenTs, readIds]);

  const unreadCount = displayItems.filter((d) => !d.read).length;

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setLastSeenTs(now);
    setReadIds(new Set());
    try {
      localStorage.setItem("notif_last_seen", String(now));
      localStorage.removeItem("notif_read_ids");
    } catch { /* ignore */ }
    notificationStore.markAllRead();
  }, []);

  const handleOpen = () => {
    setOpen(!open);
  };

  const handleItemClick = (item: DisplayItem) => {
    // Mark as read
    if (item.storeNotification) {
      notificationStore.markRead(item.id);
    } else {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    }

    // If store notification has actions, don't navigate — actions are in-panel
    if (item.storeNotification?.actions?.length) return;

    // Navigate to relevant page
    const base = TYPE_ROUTE[item.type] || "/activity";
    const paramKey = TYPE_QUERY_PARAM[item.type];
    const route = paramKey && item.source
      ? `${base}?${paramKey}=${encodeURIComponent(item.source)}`
      : base;
    setOpen(false);
    router.push(route);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        data-notification-bell
        onClick={handleOpen}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#a8b0ba] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]",
          open && "bg-stone-100 text-stone-700 dark:bg-[#20252a] dark:text-[#f5f7fa]",
        )}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl dark:border-[#2c343d] dark:bg-[#171a1d] animate-in slide-in-from-top-1 fade-in duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-[#2c343d]">
            <p className="text-sm font-semibold text-stone-900 dark:text-[#f5f7fa]">
              Notifications
            </p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-[#8d98a5] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]"
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark read
                </button>
              )}
              <span className="text-xs text-stone-500 dark:text-[#8d98a5]">
                {displayItems.length} alert{displayItems.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Events */}
          <div className="max-h-80 overflow-y-auto overscroll-contain" role="list" aria-label="Alert notifications" aria-live="polite">
            {displayItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <Bell className="h-5 w-5 text-stone-300 dark:text-[#4a5260]" />
                <p className="text-xs text-stone-500 dark:text-[#8d98a5]">
                  No alerts — everything looks good
                </p>
              </div>
            ) : (
              displayItems.map((item) => {
                const Icon =
                  item.type === "pairing"
                    ? TYPE_ICON.pairing
                    : STATUS_ICON[item.status] || Info;
                return (
                  <div key={item.id} role="listitem">
                    <button
                      type="button"
                      onClick={() => handleItemClick(item)}
                      className={cn(
                        "flex w-full gap-3 border-b border-stone-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-stone-50 dark:border-[#1e2228] dark:hover:bg-[#1a1f25]",
                        !item.read && "bg-stone-50 dark:bg-[#151920]",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                          item.status === "error"
                            ? "bg-red-100 dark:bg-red-500/10"
                            : item.status === "warning"
                              ? "bg-amber-100 dark:bg-amber-500/10"
                              : item.status === "success"
                                ? "bg-emerald-100 dark:bg-emerald-500/10"
                                : "bg-stone-100 dark:bg-[#20252a]",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-3 w-3",
                            item.status === "error"
                              ? "text-red-500 dark:text-red-400"
                              : item.status === "warning"
                                ? "text-amber-500 dark:text-amber-400"
                                : item.status === "success"
                                  ? "text-emerald-500 dark:text-emerald-400"
                                  : "text-stone-400 dark:text-[#8d98a5]",
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-stone-900 dark:text-[#f5f7fa]">
                          {item.title}
                        </p>
                        {item.detail && (
                          <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-[#8d98a5]">
                            {item.detail}
                          </p>
                        )}
                        {/* Action buttons for store notifications */}
                        {item.storeNotification?.actions && item.storeNotification.actions.length > 0 && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            {item.storeNotification.actions.map((action) => (
                              <button
                                key={action.label}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  action.callback();
                                  notificationStore.markRead(item.id);
                                }}
                                className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-[#20252a] dark:text-[#c8d0da] dark:hover:bg-[#2a2f36]"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <p className="text-xs text-stone-400 dark:text-[#7a8591]">
                            {timeAgo(item.timestamp)}
                          </p>
                          <span className="text-xs text-stone-300 dark:text-[#4a5260]">
                            {TYPE_ROUTE[item.type]?.slice(1) || item.type}
                          </span>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
