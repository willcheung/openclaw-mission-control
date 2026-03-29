/**
 * env-manager.ts
 *
 * Read and write .env files directly from the filesystem.
 * Handles multiple source files (openclaw home, workspace).
 * NEVER logs values — only used server-side.
 */

import { readFile, writeFile, access } from "fs/promises";
import { join, resolve } from "path";
import { getOpenClawHome, getDefaultWorkspace } from "@/lib/paths";

export type EnvSource = "openclaw" | "workspace";

export type EnvVar = {
  key: string;
  source: EnvSource;
  filePath: string; // absolute path to the .env file
  // Value is returned only when explicitly requested (GET /api/env/:key)
  masked: string; // "••••••" or first2 + "••••" + last2 for short reveal
};

export type EnvVarWithValue = EnvVar & { value: string };

// ── .env file parser ──────────────────────────────────────────────────────────

/** Parse a .env file into a key→value map, preserving order as an array. */
export function parseDotenv(content: string): Array<{ key: string; value: string; raw: string }> {
  const entries: Array<{ key: string; value: string; raw: string }> = [];
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    // Skip comments and blank lines but preserve them in output
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.push({ key, value, raw });
  }
  return entries;
}

/** Serialize a key→value map back into .env content. */
export function serializeDotenv(
  original: string,
  updates: Map<string, string | null>
): string {
  const lines = original.split("\n");
  const handled = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) {
      result.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (!updates.has(key)) {
      result.push(line);
      continue;
    }
    handled.add(key);
    const newValue = updates.get(key);
    if (newValue == null) {
      // Delete: skip the line
      continue;
    }
    // Update value — preserve any quoting style if value contains spaces
    const needsQuotes = newValue.includes(" ") || newValue.includes("\t");
    result.push(`${key}=${needsQuotes ? `"${newValue}"` : newValue}`);
  }

  // Append new keys that weren't in the original file
  for (const [key, value] of updates.entries()) {
    if (handled.has(key) || value === null) continue;
    const needsQuotes = value.includes(" ") || value.includes("\t");
    result.push(`${key}=${needsQuotes ? `"${value}"` : value}`);
  }

  // Ensure trailing newline
  const joined = result.join("\n");
  return joined.endsWith("\n") ? joined : joined + "\n";
}

export function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "••••••••";
}

// ── Source resolution ─────────────────────────────────────────────────────────

export async function getEnvSources(): Promise<
  Array<{ source: EnvSource; filePath: string }>
> {
  const home = getOpenClawHome();
  const workspace = await getDefaultWorkspace();
  return [
    { source: "openclaw" as const, filePath: join(home, ".env") },
    { source: "workspace" as const, filePath: join(workspace, ".env") },
  ];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all env vars (values masked). Later sources override earlier ones with same key. */
export async function listEnvVars(): Promise<EnvVar[]> {
  const sources = await getEnvSources();
  const vars: EnvVar[] = [];

  for (const { source, filePath } of sources) {
    if (!(await fileExists(filePath))) continue;
    const content = await readFile(filePath, "utf-8");
    for (const { key } of parseDotenv(content)) {
      vars.push({
        key,
        source,
        filePath,
        masked: "••••••••",
      });
    }
  }

  return vars;
}

/** Get a single env var with its real value. */
export async function getEnvVar(key: string): Promise<EnvVarWithValue | null> {
  const sources = await getEnvSources();
  // Later sources win (workspace overrides openclaw)
  let result: EnvVarWithValue | null = null;

  for (const { source, filePath } of sources) {
    if (!(await fileExists(filePath))) continue;
    const content = await readFile(filePath, "utf-8");
    const entries = parseDotenv(content);
    const found = entries.find((e) => e.key === key);
    if (found) {
      result = {
        key,
        source,
        filePath,
        masked: maskValue(found.value),
        value: found.value,
      };
    }
  }

  return result;
}

/**
 * Set an env var. Writes to the specified source file.
 * If no source specified, writes to workspace .env (preferred).
 */
export async function setEnvVar(
  key: string,
  value: string,
  source: EnvSource = "workspace"
): Promise<void> {
  validateKey(key);
  const sources = await getEnvSources();
  const target = sources.find((s) => s.source === source);
  if (!target) throw new Error(`Unknown source: ${source}`);

  const { filePath } = target;
  let original = "";
  try {
    original = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist yet — start empty
  }

  const updates = new Map<string, string | null>([[key, value]]);
  const updated = serializeDotenv(original, updates);
  await writeFile(filePath, updated, { encoding: "utf-8", mode: 0o600 });
}

/** Delete an env var from its source file. */
export async function deleteEnvVar(key: string): Promise<boolean> {
  const sources = await getEnvSources();
  let deleted = false;

  for (const { filePath } of sources) {
    if (!(await fileExists(filePath))) continue;
    const content = await readFile(filePath, "utf-8");
    const entries = parseDotenv(content);
    if (!entries.some((e) => e.key === key)) continue;

    const updates = new Map<string, string | null>([[key, null]]);
    const updated = serializeDotenv(content, updates);
    await writeFile(filePath, updated, { encoding: "utf-8", mode: 0o600 });
    deleted = true;
  }

  return deleted;
}

function validateKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env var key: "${key}". Must match [A-Za-z_][A-Za-z0-9_]*`);
  }
}
