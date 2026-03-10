"use client";

import { useCallback, useEffect, useState } from "react";
import { X, TriangleAlert } from "lucide-react";
import { useGatewayStatusStore } from "@/lib/gateway-status-store";

const DISMISS_KEY = "cli-mode-banner-dismissed";

/**
 * Amber warning banner shown at the top of the page when Mission Control
 * detects it is running in CLI fallback mode (transport === "cli").
 *
 * Dismissal is stored in sessionStorage — the banner won't nag again until
 * the browser tab is closed, but will reappear on a fresh session so the
 * user is always informed after a cold start.
 */
export function CliModeBanner() {
  const { transport, initialCheckDone } = useGatewayStatusStore();
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash

  // Initialise dismissed state from sessionStorage after mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, []);

  // Only render once we know the transport mode and the user hasn't dismissed
  if (!initialCheckDone || transport !== "cli" || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="relative z-40 flex items-center gap-2.5 bg-amber-400/15 px-4 py-2 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300 border-b border-amber-400/30"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <p className="flex-1 text-xs font-medium">
        Running in CLI fallback mode &mdash; set{" "}
        <code className="rounded bg-amber-400/20 px-1 py-0.5 font-mono text-[11px]">
          OPENCLAW_GATEWAY_TOKEN
        </code>{" "}
        for better performance
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
        aria-label="Dismiss CLI fallback warning"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
