/**
 * GET /api/events/stream
 *
 * Server-Sent Events stream for real-time workspace file change events.
 * Clients subscribe and receive AuditEvent JSON as SSE data.
 *
 * Implements exponential backoff hint via retry field.
 * Connection is kept alive with heartbeat comments every 15s.
 */

import { NextRequest } from "next/server";
import { subscribeToFileEvents } from "@/lib/fs-watcher";
import type { AuditEvent } from "@/lib/fs-watcher";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const connect = `retry: 1000\ndata: ${JSON.stringify({ type: "connected" })}\n\n`;
      controller.enqueue(encoder.encode(connect));

      // Subscribe to file events from the watcher
      const unsubscribe = subscribeToFileEvents((event: AuditEvent) => {
        try {
          const msg = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch {
          // Client disconnected
        }
      });

      // Heartbeat every 15s to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeatInterval);
          unsubscribe();
        }
      }, 15000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      };

      // Listen for client disconnect via abort signal
      _req.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
