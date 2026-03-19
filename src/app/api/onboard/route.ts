/**
 * Onboarding API
 *
 * GET  /api/onboard
 *   Returns setup status including hasModel, hasChannel, hasApiKey, etc.
 *
 * POST /api/onboard
 *   { action: "validate-key", provider, token }
 *   { action: "list-models",  provider, token }
 *   { action: "save-and-restart", provider, apiKey, model, telegramToken?, discordToken? }
 */

import { NextRequest, NextResponse } from "next/server";
import { access, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { runCli, runCliCaptureBoth, gatewayCall } from "@/lib/openclaw";
import { getOpenClawBin, getOpenClawHome, getGatewayUrl } from "@/lib/paths";
import { patchConfig } from "@/lib/gateway-config";
import {
  PROVIDER_ENV_KEYS,
  validateProviderToken,
  fetchModelsFromProvider,
  buildProviderCredentialPatch,
} from "@/lib/provider-auth";

export const dynamic = "force-dynamic";

/* ── Helpers ───────────────────────────────────────── */

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function checkGatewayHealth(
  gatewayUrl: string,
): Promise<{ running: boolean; version?: string }> {
  try {
    const res = await fetch(gatewayUrl, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { running: false };
    const data = await res.json().catch(() => ({}));
    return {
      running: true,
      version: typeof data.version === "string" ? data.version : undefined,
    };
  } catch {
    return { running: false };
  }
}

function getDotPath(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (const key of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/* ── GET /api/onboard ──────────────────────────────── */

export async function GET() {
  try {
    const home = getOpenClawHome();
    const configPath = join(home, "openclaw.json");
    const authPath = join(home, "agents", "main", "agent", "auth-profiles.json");

    const [binPath, configExists, authExists, gatewayUrl] = await Promise.all([
      getOpenClawBin().catch(() => null),
      fileExists(configPath),
      fileExists(authPath),
      getGatewayUrl(),
    ]);

    const installed = binPath !== null;

    let version: string | null = null;
    if (installed) {
      try {
        const out = await runCli(["--version"], 5000);
        version = out.trim().split("\n").pop()?.trim() || null;
      } catch {
        // binary found but --version failed
      }
    }

    const gateway = await checkGatewayHealth(gatewayUrl);

    let hasModel = false;
    let hasApiKey = false;
    let hasLocalProvider = false;
    let hasChannel = false;

    if (configExists) {
      try {
        const config = await readJsonSafe<Record<string, unknown>>(configPath);
        if (config) {
          // Check model
          const model = getDotPath(config, "agents.defaults.model");
          hasModel = Boolean(
            typeof model === "string" ? model : (model as Record<string, unknown>)?.primary,
          );

          // Check API keys in config.env
          const env = getDotPath(config, "env");
          if (env && typeof env === "object") {
            hasApiKey = Object.values(PROVIDER_ENV_KEYS).some((key) => {
              const value = (env as Record<string, unknown>)[key];
              return typeof value === "string" && value.trim().length > 0;
            });
          }

          // Check auth.profiles
          const authProfiles = getDotPath(config, "auth.profiles");
          if (!hasApiKey && authProfiles && typeof authProfiles === "object") {
            hasApiKey = Object.keys(authProfiles as Record<string, unknown>).length > 0;
          }

          // Check local/custom providers
          const providers = getDotPath(config, "models.providers");
          if (providers && typeof providers === "object") {
            hasLocalProvider = Object.keys(providers as Record<string, unknown>).some((k) => {
              const p = (providers as Record<string, unknown>)[k];
              if (!p || typeof p !== "object") return false;
              const baseUrl = (p as Record<string, unknown>).baseUrl;
              return typeof baseUrl === "string" && baseUrl.trim().length > 0;
            });
          }

          // Check channels — any key under channels with a non-empty object counts
          const channels = getDotPath(config, "channels");
          if (channels && typeof channels === "object") {
            hasChannel = Object.keys(channels as Record<string, unknown>).some((k) => {
              const ch = (channels as Record<string, unknown>)[k];
              return ch && typeof ch === "object" && Object.keys(ch as Record<string, unknown>).length > 0;
            });
          }
        }
      } catch {
        // config unreadable
      }
    }

    // Tier 3: per-agent auth-profiles.json
    if (!hasApiKey && authExists) {
      try {
        const auth = await readJsonSafe<{ profiles?: Record<string, unknown> }>(authPath);
        hasApiKey = Boolean(auth?.profiles && Object.keys(auth.profiles).length > 0);
      } catch {
        // auth unreadable
      }
    }

    // Tier 4: process.env
    if (!hasApiKey) {
      hasApiKey = Object.values(PROVIDER_ENV_KEYS).some(
        (key) => typeof process.env[key] === "string" && process.env[key]!.trim().length > 0,
      );
    }

    // Detect Ollama
    let hasOllama = false;
    try {
      const ollamaRes = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      hasOllama = ollamaRes.ok;
    } catch {
      // not running
    }

    const hasCredentials = hasApiKey || hasLocalProvider || hasOllama;

    return NextResponse.json({
      installed,
      configured: hasCredentials && hasModel,
      configExists,
      hasModel,
      hasApiKey,
      hasLocalProvider,
      hasOllama,
      hasChannel,
      gatewayRunning: gateway.running,
      version: version || gateway.version || null,
      gatewayUrl,
      home,
    });
  } catch (err) {
    console.error("Onboard GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST /api/onboard ─────────────────────────────── */

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      const raw = await request.json();
      body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid or empty JSON body" },
        { status: 400 },
      );
    }
    const action = body.action as string;

    switch (action) {
      /* ── validate-key ──────────────────────────────── */
      case "validate-key": {
        const provider = String(body.provider || "").trim();
        const token = String(body.token || "").trim();
        if (!provider || !token) {
          return NextResponse.json(
            { ok: false, error: "Provider and token are required" },
            { status: 400 },
          );
        }
        const result = await validateProviderToken(provider, token);
        return NextResponse.json(result);
      }

      /* ── list-models ───────────────────────────────── */
      case "list-models": {
        const provider = String(body.provider || "").trim();
        const token = String(body.token || "").trim();
        if (!provider || !token) {
          return NextResponse.json(
            { ok: false, error: "Provider and token are required" },
            { status: 400 },
          );
        }
        try {
          const models = await fetchModelsFromProvider(provider, token);
          return NextResponse.json({ ok: true, models });
        } catch (err) {
          return NextResponse.json({
            ok: false,
            error: `Failed to fetch models: ${err}`,
            models: [],
          });
        }
      }

      /* ── save-and-restart ──────────────────────────── */
      case "save-and-restart": {
        const provider = String(body.provider || "").trim();
        const apiKeyValue = String(body.apiKey || "").trim();
        const model = String(body.model || "").trim();
        const telegramToken = String(body.telegramToken || "").trim();
        const discordToken = String(body.discordToken || "").trim();

        if (!provider || !apiKeyValue || !model) {
          return NextResponse.json(
            { ok: false, error: "Provider, API key, and model are required" },
            { status: 400 },
          );
        }

        const envKey = PROVIDER_ENV_KEYS[provider];
        if (!envKey) {
          return NextResponse.json(
            { ok: false, error: `Unsupported provider: ${provider}` },
            { status: 400 },
          );
        }

        const home = getOpenClawHome();
        const configPath = join(home, "openclaw.json");
        const configExists = await fileExists(configPath);
        const isHosted =
          process.env.AGENTBAY_HOSTED === "true" ||
          process.env.NEXT_PUBLIC_AGENTBAY_HOSTED === "true";
        const hasChannels = Boolean(telegramToken || discordToken);

        // ── Step 1: Bootstrap config/workspace/daemon (only when no config yet) ──
        if (!configExists) {
          const onboardArgs = [
            "onboard",
            "--non-interactive",
            "--accept-risk",
            "--mode", "local",
            "--auth-choice", "skip",
            "--skip-channels",
            "--skip-skills",
            "--skip-search",
            "--skip-ui",
          ];
          if (isHosted) {
            onboardArgs.push("--skip-health");
          } else {
            onboardArgs.push("--install-daemon", "--daemon-runtime", "node");
          }

          try {
            const onboardResult = await runCliCaptureBoth(onboardArgs, 60000);
            if (onboardResult.code !== 0) {
              const detail = String(onboardResult.stderr || onboardResult.stdout || "").trim();
              return NextResponse.json(
                { ok: false, error: `Bootstrap failed: ${detail || `exit code ${onboardResult.code}`}` },
                { status: 500 },
              );
            }
          } catch (err) {
            return NextResponse.json(
              { ok: false, error: `Bootstrap failed: ${err instanceof Error ? err.message : err}` },
              { status: 500 },
            );
          }
        }

        // ── Step 2: Wait for gateway to be healthy ──
        const gatewayUrl = await getGatewayUrl();
        let gatewayReady = false;
        for (let i = 0; i < 15; i++) {
          const health = await checkGatewayHealth(gatewayUrl);
          if (health.running) { gatewayReady = true; break; }
          await new Promise((r) => setTimeout(r, 1500));
        }

        // ── Step 3: Build unified config patch ──
        const patch: Record<string, unknown> = buildProviderCredentialPatch(provider, apiKeyValue);
        patch.agents = { defaults: { model: { primary: model } } };

        if (telegramToken) {
          const channels = (patch.channels ?? {}) as Record<string, unknown>;
          channels.telegram = { enabled: true, botToken: telegramToken, dmPolicy: "pairing" };
          patch.channels = channels;
        }
        if (discordToken) {
          const channels = (patch.channels ?? {}) as Record<string, unknown>;
          channels.discord = { enabled: true, token: discordToken, dmPolicy: "pairing" };
          patch.channels = channels;
        }

        // ── Step 3a: Apply via gateway RPC (preferred — atomic + live reload) ──
        let patchMethod = "";
        if (gatewayReady) {
          try {
            await patchConfig(patch, { restartDelayMs: hasChannels ? 2000 : 0 });
            patchMethod = "gateway";
          } catch (err) {
            console.error("patchConfig RPC failed, will try disk fallback:", err);
          }
        }

        // ── Step 3b: Disk-write fallback (if gateway unavailable or RPC failed) ──
        if (!patchMethod) {
          try {
            let config: Record<string, unknown> = {};
            try { config = JSON.parse(await readFile(configPath, "utf-8")); } catch { /* fresh */ }

            const env = (config.env || {}) as Record<string, unknown>;
            env[envKey] = apiKeyValue;
            config.env = env;

            const auth = (config.auth || {}) as Record<string, unknown>;
            const profiles = (auth.profiles || {}) as Record<string, unknown>;
            profiles[`${provider}:default`] = { provider, mode: "api_key" };
            auth.profiles = profiles;
            config.auth = auth;

            const agents = (config.agents || {}) as Record<string, unknown>;
            const defaults = (agents.defaults || {}) as Record<string, unknown>;
            defaults.model = { primary: model };
            agents.defaults = defaults;
            config.agents = agents;

            if (telegramToken) {
              const channels = (config.channels || {}) as Record<string, unknown>;
              channels.telegram = { enabled: true, botToken: telegramToken, dmPolicy: "pairing" };
              config.channels = channels;
            }
            if (discordToken) {
              const channels = (config.channels || {}) as Record<string, unknown>;
              channels.discord = { enabled: true, token: discordToken, dmPolicy: "pairing" };
              config.channels = channels;
            }

            await mkdir(dirname(configPath), { recursive: true });
            await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
            patchMethod = "disk";
          } catch (err) {
            return NextResponse.json(
              { ok: false, error: `Config save failed: ${err instanceof Error ? err.message : err}` },
              { status: 500 },
            );
          }
        }

        // ── Step 4: If channels configured, poll until channel is running ──
        if (hasChannels && gatewayReady) {
          const targetChannel = telegramToken ? "telegram" : "discord";
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 1500));
            try {
              const status = await gatewayCall<Record<string, unknown>>("channels.status", {}, 8000);
              const channels = status && typeof status === "object"
                ? (status as Record<string, unknown>).channels : null;
              if (channels && typeof channels === "object") {
                const ch = (channels as Record<string, unknown>)[targetChannel];
                if (ch && typeof ch === "object" && (ch as Record<string, unknown>).running === true) break;
              }
            } catch {
              // gateway may still be restarting after config.patch
            }
          }
        }

        // ── Step 5: Verify config was applied ──
        if (gatewayReady && patchMethod === "gateway") {
          try {
            const cfg = await gatewayCall<Record<string, unknown>>("config.get", undefined, 8000);
            const resolved = cfg && typeof cfg === "object" && typeof (cfg as Record<string, unknown>).resolved === "object"
              ? (cfg as Record<string, unknown>).resolved as Record<string, unknown>
              : null;
            if (resolved) {
              const savedEnv = resolved.env as Record<string, unknown> | undefined;
              const savedKey = savedEnv?.[envKey];
              if (!savedKey || typeof savedKey !== "string" || !savedKey.trim()) {
                console.warn("Config verification: API key not found in resolved config after patchConfig");
              }
            }
          } catch {
            // non-fatal — config was already patched
          }
        }

        return NextResponse.json({ ok: true, method: patchMethod });
      }

      /* ── get-bot-info ─────────────────────────────── */
      case "get-bot-info": {
        const botToken = String(body.token || "").trim();
        const channel = String(body.channel || "").trim();
        if (!botToken || !channel) {
          return NextResponse.json({ ok: false });
        }
        try {
          if (channel === "telegram") {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
              signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
              const data = await res.json();
              const bot = data.result;
              return NextResponse.json({
                ok: true,
                username: bot?.username ? `@${bot.username}` : null,
                name: bot?.first_name || null,
              });
            }
          }
          if (channel === "discord") {
            const res = await fetch("https://discord.com/api/v10/users/@me", {
              headers: { Authorization: `Bot ${botToken}` },
              signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
              const bot = await res.json();
              return NextResponse.json({
                ok: true,
                username: bot?.username || null,
                name: bot?.global_name || bot?.username || null,
              });
            }
          }
        } catch { /* silent */ }
        return NextResponse.json({ ok: false });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("Onboard POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
