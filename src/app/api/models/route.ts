import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { getOpenClawHome } from "@/lib/paths";
import { buildModelsSummary } from "@/lib/models-summary";
import {
  buildProviderCredentialPatch,
  PROVIDER_ENV_KEYS,
  validateProviderToken,
  fetchModelsFromProvider,
} from "@/lib/provider-auth";
import { patchConfig } from "@/lib/gateway-config";

export const dynamic = "force-dynamic";

const OPENCLAW_HOME = getOpenClawHome();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// ── GET /api/models ─────────────────────────────
// Returns current model config + summary for the UI.

export async function GET() {
  try {
    const summary = await buildModelsSummary();
    return json(summary);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ── POST /api/models ────────────────────────────
// Actions: auth-provider, remove-provider, set-primary, list-models

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "");

    switch (action) {
      // ── Connect a provider (save API key + optionally set default model) ──
      case "auth-provider": {
        const provider = String(body.provider || "").trim().toLowerCase();
        const token = String(body.token || "").trim();
        const modelToSet = String(body.model || "").trim();

        if (!provider || !token) {
          return json({ error: "Provider and API key are required" }, 400);
        }

        // Validate the key against the provider's API
        const validation = await validateProviderToken(provider, token);
        if (!validation.ok) {
          return json({ error: validation.error || "Invalid API key" }, 400);
        }

        const envKey = PROVIDER_ENV_KEYS[provider];
        let method = "";

        // Layer 1: Gateway RPC (preferred — triggers live reload)
        if (envKey) {
          try {
            const patch = buildProviderCredentialPatch(provider, token);
            if (modelToSet) {
              patch.agents = { defaults: { model: { primary: modelToSet } } };
            }
            await patchConfig(patch);
            method = "gateway";
          } catch {
            method = "";
          }
        }

        // Layer 2: Direct disk write (fallback)
        if (!method) {
          try {
            const configPath = join(OPENCLAW_HOME, "openclaw.json");
            const authPath = join(OPENCLAW_HOME, "agents", "main", "agent", "auth-profiles.json");

            // Write to openclaw.json
            let config: Record<string, unknown> = {};
            try { config = JSON.parse(await readFile(configPath, "utf-8")); } catch { /* fresh */ }

            if (envKey) {
              const env = (config.env || {}) as Record<string, unknown>;
              env[envKey] = token;
              config.env = env;
            }
            const auth = (config.auth || {}) as Record<string, unknown>;
            const profiles = (auth.profiles || {}) as Record<string, unknown>;
            profiles[`${provider}:default`] = { provider, mode: "api_key" };
            auth.profiles = profiles;
            config.auth = auth;

            if (modelToSet) {
              const agents = (config.agents || {}) as Record<string, unknown>;
              const defaults = (agents.defaults || {}) as Record<string, unknown>;
              defaults.model = { primary: modelToSet };
              agents.defaults = defaults;
              config.agents = agents;
            }

            await mkdir(dirname(configPath), { recursive: true });
            await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

            // Write to auth-profiles.json
            let authData: { profiles: Record<string, unknown> } = { profiles: {} };
            try {
              authData = JSON.parse(await readFile(authPath, "utf-8"));
              if (!authData.profiles) authData.profiles = {};
            } catch { /* fresh */ }
            authData.profiles[`${provider}:default`] = { provider, type: "api_key", key: token };
            await mkdir(dirname(authPath), { recursive: true });
            await writeFile(authPath, JSON.stringify(authData, null, 2) + "\n", "utf-8");

            method = "disk";
          } catch (err) {
            return json({ error: `Failed to save credentials: ${err}` }, 500);
          }
        }

        return json({ ok: true, provider, method, modelSet: modelToSet || null });
      }

      // ── Remove a provider's credentials ──
      case "remove-provider": {
        const provider = String(body.provider || "").trim().toLowerCase();
        if (!provider) return json({ error: "Provider is required" }, 400);

        const envKey = PROVIDER_ENV_KEYS[provider];

        // Try gateway RPC first
        try {
          const patch: Record<string, unknown> = {};
          if (envKey) {
            patch.env = { [envKey]: "" };
          }
          patch.auth = { profiles: { [`${provider}:default`]: null } };
          await patchConfig(patch);
          return json({ ok: true, provider });
        } catch { /* fallback to disk */ }

        // Disk fallback
        try {
          const configPath = join(OPENCLAW_HOME, "openclaw.json");
          let config: Record<string, unknown> = {};
          try { config = JSON.parse(await readFile(configPath, "utf-8")); } catch { /* */ }

          if (envKey) {
            const env = (config.env || {}) as Record<string, unknown>;
            delete env[envKey];
            config.env = env;
          }
          const auth = (config.auth || {}) as Record<string, unknown>;
          const profiles = (auth.profiles || {}) as Record<string, unknown>;
          delete profiles[`${provider}:default`];
          auth.profiles = profiles;
          config.auth = auth;
          await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

          // Also clean auth-profiles.json
          const authPath = join(OPENCLAW_HOME, "agents", "main", "agent", "auth-profiles.json");
          try {
            const authData = JSON.parse(await readFile(authPath, "utf-8"));
            if (authData.profiles) {
              delete authData.profiles[`${provider}:default`];
              await writeFile(authPath, JSON.stringify(authData, null, 2) + "\n", "utf-8");
            }
          } catch { /* */ }

          return json({ ok: true, provider });
        } catch (err) {
          return json({ error: `Failed to remove provider: ${err}` }, 500);
        }
      }

      // ── Set the default model ──
      case "set-primary": {
        const model = String(body.model || "").trim();
        if (!model) return json({ error: "Model is required" }, 400);

        try {
          await patchConfig({ agents: { defaults: { model: { primary: model } } } });
          return json({ ok: true, model });
        } catch (patchErr) {
          console.error("[set-primary] patchConfig failed, trying disk fallback:", patchErr);
          // Disk fallback — write to the main config file
          try {
            const configPath = join(OPENCLAW_HOME, "openclaw.json");
            let config: Record<string, unknown> = {};
            try { config = JSON.parse(await readFile(configPath, "utf-8")); } catch { /* */ }
            const agents = (config.agents || {}) as Record<string, unknown>;
            const defaults = (agents.defaults || {}) as Record<string, unknown>;
            defaults.model = { primary: model };
            agents.defaults = defaults;
            config.agents = agents;
            await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
            return json({ ok: true, model });
          } catch (err) {
            return json({ error: `Failed to set model: ${err}` }, 500);
          }
        }
      }

      // ── List models from a provider ──
      // Accepts explicit token OR reads stored key from disk
      case "list-models": {
        const provider = String(body.provider || "").trim().toLowerCase();
        let token = String(body.token || "").trim();
        if (!provider) return json({ error: "Provider is required" }, 400);

        // If no token passed, try to read stored key
        if (!token) {
          try {
            const authPath = join(OPENCLAW_HOME, "agents", "main", "agent", "auth-profiles.json");
            const authData = JSON.parse(await readFile(authPath, "utf-8"));
            const profile = authData?.profiles?.[`${provider}:default`];
            if (profile?.key) token = profile.key;
          } catch { /* */ }

          // Also try env block in openclaw.json
          if (!token) {
            try {
              const configPath = join(OPENCLAW_HOME, "openclaw.json");
              const config = JSON.parse(await readFile(configPath, "utf-8"));
              const envKey = PROVIDER_ENV_KEYS[provider];
              if (envKey && config?.env?.[envKey]) token = config.env[envKey];
            } catch { /* */ }
          }
        }

        if (!token) return json({ error: "No API key found for this provider" }, 400);

        try {
          const models = await fetchModelsFromProvider(provider, token);
          return json({ ok: true, models });
        } catch (err) {
          return json({ error: `Failed to fetch models: ${err}` }, 500);
        }
      }

      // ── Validate an API key without saving ──
      case "test-key": {
        const provider = String(body.provider || "").trim().toLowerCase();
        const token = String(body.token || "").trim();
        if (!provider || !token) return json({ error: "Provider and token required" }, 400);

        const result = await validateProviderToken(provider, token);
        return json(result);
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}
