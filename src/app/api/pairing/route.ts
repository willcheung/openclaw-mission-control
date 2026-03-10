import { NextRequest, NextResponse } from "next/server";
import { gatewayCall, runCli } from "@/lib/openclaw";
import { getOpenClawHome } from "@/lib/paths";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

/* ── Types ────────────────────────────────────────── */

type DmRequest = {
  channel: string;
  code: string;
  account?: string;
  senderId?: string;
  senderName?: string;
  message?: string;
  createdAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
};

type DeviceRequest = {
  requestId: string;
  deviceId?: string;
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  createdAtMs?: number;
  [key: string]: unknown;
};

/* ── GET: list all pending requests ──────────────── */

export async function GET() {
  const home = getOpenClawHome();
  const dmRequests: DmRequest[] = [];
  const deviceRequests: DeviceRequest[] = [];

  // 1. Discover DM pairing channels by scanning credentials dir
  const credDirs = [join(home, "credentials")];
  for (const credDir of credDirs) {
    try {
      const files = await readdir(credDir);
      const pairingFiles = files.filter((f) => f.endsWith("-pairing.json"));

      for (const file of pairingFiles) {
        const channel = file.replace("-pairing.json", "");
        try {
          const raw = await readFile(join(credDir, file), "utf-8");
          const data = JSON.parse(raw);
          // data can be an array of requests or { requests: [...] }
          const requests = Array.isArray(data)
            ? data
            : Array.isArray(data.requests)
            ? data.requests
            : [];

          for (const req of requests) {
            const code = req.code || req.pairingCode || "";
            if (code && !dmRequests.some((d) => d.code === code && d.channel === channel)) {
              // Normalize meta fields to top-level senderName for the frontend
              const meta = req.meta || {};
              const senderName =
                req.senderName ||
                [meta.firstName, meta.lastName].filter(Boolean).join(" ") ||
                meta.username ||
                undefined;
              dmRequests.push({
                ...req,
                channel,
                code,
                account:
                  typeof req.accountId === "string"
                    ? req.accountId
                    : typeof req.account === "string"
                      ? req.account
                      : undefined,
                senderName,
                senderId: req.senderId || req.id || meta.username || undefined,
              });
            }
          }
        } catch {
          // File may be empty or malformed
        }
      }
    } catch {
      // credentials dir may not exist
    }
  }

  // 2. Device pairing requests
  try {
    const data = await gatewayCall<{
      pending: DeviceRequest[];
      paired: unknown[];
    }>("device.pair.list", {}, 8000);
    deviceRequests.push(...(data.pending || []));
  } catch {
    // gateway may be unavailable
  }

  return NextResponse.json({
    dm: dmRequests,
    devices: deviceRequests,
    total: dmRequests.length + deviceRequests.length,
  });
}

/* ── POST: approve / reject ──────────────────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "approve-dm": {
        const channel = body.channel as string;
        const code = body.code as string;
        const account = body.account as string | undefined;
        if (!channel || !code) {
          return NextResponse.json(
            { error: "channel and code required" },
            { status: 400 }
          );
        }
        const args = ["pairing", "approve", channel, code];
        if (account && account.trim()) args.push("--account", account.trim());
        args.push("--notify");
        const output = await runCli(
          args,
          10000
        );
        return NextResponse.json({ ok: true, action, channel, code, account, output });
      }

      case "approve-device": {
        const requestId = body.requestId as string;
        if (!requestId) {
          return NextResponse.json(
            { error: "requestId required" },
            { status: 400 }
          );
        }
        const result = await gatewayCall<Record<string, unknown>>(
          "device.pair.approve",
          { requestId },
          10000,
        );
        return NextResponse.json({ ok: true, action, requestId, result });
      }

      case "reject-device": {
        const requestId = body.requestId as string;
        if (!requestId) {
          return NextResponse.json(
            { error: "requestId required" },
            { status: 400 }
          );
        }
        const result = await gatewayCall<Record<string, unknown>>(
          "device.pair.reject",
          { requestId },
          10000,
        );
        return NextResponse.json({ ok: true, action, requestId, result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Pairing API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
