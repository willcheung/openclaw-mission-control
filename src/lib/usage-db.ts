import { execFile } from "child_process";
import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { promisify } from "util";
import { getOpenClawHome } from "@/lib/paths";

const exec = promisify(execFile);

const DB_PATH = join(getOpenClawHome(), "mission-control", "usage.db");

let initialized = false;
let initPromise: Promise<void> | null = null;

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function getUsageDbPath(): string {
  return DB_PATH;
}

export function sqliteValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return sqlQuote(String(value));
}

// Every sqlite3 subprocess must set busy_timeout so concurrent connections
// wait instead of failing immediately with SQLITE_BUSY.
const PRAGMA_PREFIX = "PRAGMA busy_timeout=5000;\n";

async function sqlite(args: string[], timeout = 20000): Promise<string> {
  try {
    const { stdout } = await exec("sqlite3", args, { timeout });
    return stdout;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
      throw new Error("sqlite3 binary not found — install SQLite to enable usage tracking");
    }
    throw err;
  }
}

export async function usageDbExec(sql: string): Promise<void> {
  await ensureUsageDb();
  await sqlite([DB_PATH, PRAGMA_PREFIX + sql]);
}

export async function usageDbQuery<T>(sql: string): Promise<T[]> {
  await ensureUsageDb();
  // Use sqlite shell timeout command so JSON output stays parseable.
  const stdout = await sqlite(["-cmd", ".timeout 5000", "-json", DB_PATH, sql]);
  const trimmed = (stdout || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function usageDbTransaction(statements: string[]): Promise<void> {
  if (statements.length === 0) return;
  await ensureUsageDb();
  const sql = [PRAGMA_PREFIX + "BEGIN IMMEDIATE;", ...statements, "COMMIT;"].join("\n");
  try {
    await sqlite([DB_PATH, sql], 30000);
  } catch (err) {
    try {
      await sqlite([DB_PATH, PRAGMA_PREFIX + "ROLLBACK;"]);
    } catch {
      // ignore rollback failures
    }
    throw err;
  }
}

export async function usageDbSetMeta(key: string, value: string): Promise<void> {
  const now = Date.now();
  await usageDbExec(
    [
      "INSERT INTO usage_meta (key, value, updated_at_ms)",
      `VALUES (${sqliteValue(key)}, ${sqliteValue(value)}, ${now})`,
      "ON CONFLICT(key) DO UPDATE SET",
      "value = excluded.value,",
      "updated_at_ms = excluded.updated_at_ms;",
    ].join(" "),
  );
}

export async function usageDbGetMeta(key: string): Promise<string | null> {
  const rows = await usageDbQuery<{ value?: string }>(
    `SELECT value FROM usage_meta WHERE key = ${sqliteValue(key)} LIMIT 1;`,
  );
  return typeof rows[0]?.value === "string" ? rows[0].value : null;
}

export async function ensureUsageDb(): Promise<void> {
  if (initialized) return;
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    const home = getOpenClawHome();
    await mkdir(home, { recursive: true });
    await mkdir(dirname(DB_PATH), { recursive: true });
    const schema = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  observed_at_ms INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  full_model TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens_delta INTEGER NOT NULL,
  output_tokens_delta INTEGER NOT NULL,
  reasoning_tokens_delta INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens_delta INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens_delta INTEGER NOT NULL DEFAULT 0,
  total_tokens_delta INTEGER NOT NULL,
  estimated_cost_usd REAL,
  source TEXT NOT NULL DEFAULT 'gateway-session-delta',
  raw_updated_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_events_observed ON usage_events(observed_at_ms);
CREATE INDEX IF NOT EXISTS idx_usage_events_provider_model_time ON usage_events(provider, full_model, observed_at_ms);
CREATE INDEX IF NOT EXISTS idx_usage_events_agent_time ON usage_events(agent_id, observed_at_ms);
CREATE INDEX IF NOT EXISTS idx_usage_events_session_time ON usage_events(session_id, observed_at_ms);

CREATE TABLE IF NOT EXISTS session_watermarks (
  session_id TEXT PRIMARY KEY,
  last_seen_at_ms INTEGER NOT NULL,
  last_updated_at_ms INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  full_model TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens_total INTEGER NOT NULL,
  output_tokens_total INTEGER NOT NULL,
  reasoning_tokens_total INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens_total INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens_total INTEGER NOT NULL DEFAULT 0,
  total_tokens_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  full_model TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  input_per_1m REAL,
  output_per_1m REAL,
  reasoning_per_1m REAL,
  cache_read_per_1m REAL,
  cache_write_per_1m REAL,
  effective_at_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_billing_buckets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_scope TEXT NOT NULL,
  full_model TEXT,
  bucket_start_ms INTEGER NOT NULL,
  bucket_end_ms INTEGER NOT NULL,
  bucket_granularity TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  requests INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  spend_usd REAL,
  provider_payload_hash TEXT,
  provider_reference TEXT,
  fetched_at_ms INTEGER NOT NULL,
  data_latency_note TEXT,
  is_final INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_provider_billing_scope_time ON provider_billing_buckets(provider, account_scope, bucket_start_ms, full_model);
CREATE INDEX IF NOT EXISTS idx_provider_billing_fetch ON provider_billing_buckets(provider, fetched_at_ms);

CREATE TABLE IF NOT EXISTS reconciliation_buckets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_scope TEXT NOT NULL,
  full_model TEXT,
  bucket_start_ms INTEGER NOT NULL,
  bucket_end_ms INTEGER NOT NULL,
  bucket_granularity TEXT NOT NULL,
  local_estimated_spend_usd REAL,
  provider_reported_spend_usd REAL,
  local_estimated_tokens INTEGER,
  provider_reported_tokens INTEGER,
  diff_usd REAL,
  diff_pct REAL,
  status TEXT NOT NULL,
  last_reconciled_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT,
  timeline TEXT NOT NULL,
  threshold_type TEXT NOT NULL,
  threshold_value REAL NOT NULL,
  delivery_mode TEXT NOT NULL,
  delivery_channel TEXT,
  delivery_to TEXT,
  best_effort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_window_key TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_firings (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  observed_value REAL NOT NULL,
  message TEXT NOT NULL,
  fired_at_ms INTEGER NOT NULL,
  delivery_status TEXT NOT NULL,
  delivery_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_firings_rule_window ON alert_firings(rule_id, window_key);

CREATE TABLE IF NOT EXISTS usage_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
`;
    try {
      await sqlite([DB_PATH, schema], 30000);
      initialized = true;
    } catch (e) {
      initPromise = null;
      throw e;
    }
  })();
  await initPromise;
}
