import { NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw";
import { getGatewayUrl } from "@/lib/paths";
import type { DoctorIssue } from "@/lib/doctor-checks";
import { getLastRunTimestamp } from "@/lib/doctor-history";

export const dynamic = "force-dynamic";

type GatewayStatusPayload = {
  service?: {
    runtime?: { status?: string; pid?: number };
  };
  gateway?: { port?: number };
  port?: { port?: number; status?: string };
  rpc?: { ok?: boolean };
};

type GatewayHealthPayload = {
  ok?: boolean;
  checks?: Record<string, { ok?: boolean; error?: string }>;
};

/**
 * Lightweight status check using gateway RPC instead of spawning the full
 * `openclaw doctor` subprocess.  This avoids the heavy memory overhead that
 * caused OOM crashes on Docker deployments with limited RAM (see issue #22).
 *
 * The full doctor subprocess is still available via POST /api/doctor/run for
 * explicit user-initiated scans.
 */
async function probeGatewayLiveness(): Promise<boolean> {
  const url = await getGatewayUrl();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  // Lightweight: probe gateway HTTP + RPC health + last run timestamp.
  // No subprocess spawning — safe for memory-constrained environments.
  const [alive, healthResult, statusResult, lastRunAt] = await Promise.all([
    probeGatewayLiveness(),
    gatewayCall<GatewayHealthPayload>("health", {}, 8000).catch(() => null),
    gatewayCall<GatewayStatusPayload>("status", {}, 8000).catch(() => null),
    getLastRunTimestamp(),
  ]);

  const issues: DoctorIssue[] = [];

  // Derive issues from gateway liveness + RPC health checks
  if (!alive) {
    issues.push({
      severity: "error",
      checkId: "gateway-offline",
      rawText: "Gateway HTTP endpoint not reachable",
      title: "Gateway is not running",
      detail: "The background service that powers OpenClaw is stopped. Most features won't work until it's restarted.",
      fixable: true,
      fixMode: "restart",
      category: "Gateway",
    });
  } else if (healthResult) {
    if (healthResult.ok) {
      issues.push({
        severity: "info",
        checkId: "gateway-healthy",
        rawText: "Gateway is running and healthy",
        title: "Gateway is running",
        detail: "The gateway service is up and responding normally.",
        fixable: false,
        category: "Gateway",
      });
    }

    // Surface individual failing health checks
    if (healthResult.checks) {
      for (const [name, check] of Object.entries(healthResult.checks)) {
        if (check.ok === false) {
          issues.push({
            severity: "warning",
            checkId: `health-${name}`,
            rawText: check.error || `${name} check failed`,
            title: `${name.charAt(0).toUpperCase() + name.slice(1)} check failed`,
            detail: check.error || `The ${name} health check is reporting a problem.`,
            fixable: true,
            fixMode: "repair",
            category: "Services",
          });
        }
      }
    }
  } else {
    // Gateway alive but RPC unreachable
    issues.push({
      severity: "warning",
      checkId: "rpc-unreachable",
      rawText: "Gateway is reachable but RPC health check failed",
      title: "Gateway health data unavailable",
      detail: "The gateway is reachable but not responding to health queries. It may be starting up.",
      fixable: false,
      category: "Gateway",
    });
  }

  // Check RPC connectivity
  if (alive && statusResult?.rpc?.ok) {
    issues.push({
      severity: "info",
      checkId: "rpc-healthy",
      rawText: "RPC is reachable",
      title: "RPC is reachable",
      detail: "The internal RPC interface is responding to health checks.",
      fixable: false,
      category: "Gateway",
    });
  }

  let errors = 0;
  let warnings = 0;
  let healthy = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors++;
    else if (issue.severity === "warning") warnings++;
    else healthy++;
  }

  const healthScore = Math.max(0, 100 - 20 * errors - 5 * warnings);
  const overallHealth: "healthy" | "needs-attention" | "critical" =
    healthScore >= 80 ? "healthy" : healthScore >= 40 ? "needs-attention" : "critical";

  const gatewayStatus = statusResult
    ? (statusResult.service?.runtime?.status || (alive ? "online" : "unknown"))
    : (alive ? "online" : "offline");
  const gatewayPort = statusResult?.gateway?.port || statusResult?.port?.port || 18789;
  const gatewayPid = statusResult?.service?.runtime?.pid;

  return NextResponse.json({
    ts: Date.now(),
    overallHealth,
    healthScore,
    lastRunAt,
    summary: { errors, warnings, healthy },
    gateway: {
      status: gatewayStatus,
      port: gatewayPort,
      ...(gatewayPid ? { pid: gatewayPid } : {}),
    },
    issues,
  });
}
