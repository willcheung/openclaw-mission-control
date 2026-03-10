import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { getOpenClawBin } from "./paths";

const exec = promisify(execFile);

/** Env vars for all CLI subprocesses. Mission Control is always a trusted local process. */
const CLI_ENV = { ...process.env, NO_COLOR: "1", OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: "1" };

// ── Concurrency semaphore ──────────────────────────────────────────────────
// Caps the number of simultaneously live CLI subprocesses. Callers that
// exceed the limit are queued and resume in FIFO order as slots free up.

const CLI_MAX_CONCURRENT = 4;
let cliInFlight = 0;
const cliQueue: Array<() => void> = [];

function acquireCliSlot(): Promise<void> {
  if (cliInFlight < CLI_MAX_CONCURRENT) {
    cliInFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    cliQueue.push(() => {
      cliInFlight++;
      resolve();
    });
  });
}

function releaseCliSlot(): void {
  cliInFlight--;
  const next = cliQueue.shift();
  if (next) next();
}

/** Result of a CLI run when both stdout and stderr are captured. */
export type RunCliResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

/**
 * Run CLI and capture both stdout and stderr. Use for cron run and other
 * commands where we need to show full output on failure.
 */
export async function runCliCaptureBoth(
  args: string[],
  timeout = 15000
): Promise<RunCliResult> {
  await acquireCliSlot();
  try {
    const bin = await getOpenClawBin();
    return await new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        env: CLI_ENV,
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("close", (code, signal) => {
        resolve({
          stdout,
          stderr,
          code: code ?? (signal ? -1 : 0),
        });
      });
      child.on("error", reject);
    });
  } finally {
    releaseCliSlot();
  }
}

export async function runCli(
  args: string[],
  timeout = 15000,
  stdin?: string
): Promise<string> {
  await acquireCliSlot();
  try {
    const bin = await getOpenClawBin();
    if (stdin !== undefined) {
      // Use spawn for stdin piping
      return await new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
          env: CLI_ENV,
          timeout,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`Command failed (exit ${code}): ${stderr || stdout}`));
        });
        child.on("error", reject);
        child.stdin.write(stdin);
        child.stdin.end();
      });
    }
    const { stdout } = await exec(bin, args, {
      timeout,
      env: CLI_ENV,
    });
    return stdout;
  } finally {
    releaseCliSlot();
  }
}

const ANSI_ESCAPE_PATTERN =
  // Matches CSI and related ANSI escape sequences.
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function parseJsonCandidate<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function findJsonSuffix(rawOutput: string): string | null {
  const cleaned = stripAnsi(rawOutput).replace(/\r/g, "").trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  const starts: number[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === "{" || ch === "[") starts.push(i);
  }

  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const candidate = cleaned.slice(starts[i]).trim();
    if (!candidate) continue;
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    if (parseJsonCandidate(candidate) !== null) {
      return candidate;
    }
  }

  return null;
}

export function parseJsonFromCliOutput<T>(
  rawOutput: string,
  context = "CLI output"
): T {
  const candidate = findJsonSuffix(rawOutput);
  if (!candidate) {
    const snippet = stripAnsi(rawOutput).replace(/\r/g, "").trim().slice(0, 400);
    throw new Error(
      snippet
        ? `Failed to parse JSON from ${context}. Output: ${snippet}`
        : `Failed to parse JSON from ${context}: empty output`
    );
  }
  return JSON.parse(candidate) as T;
}

export async function runCliJson<T>(
  args: string[],
  timeout = 15000
): Promise<T> {
  try {
    const stdout = await runCli([...args, "--json"], timeout);
    return parseJsonFromCliOutput<T>(stdout, `openclaw ${args.join(" ")} --json`);
  } catch (err) {
    const stdout = typeof (err as { stdout?: unknown })?.stdout === "string"
      ? String((err as { stdout?: unknown }).stdout)
      : "";
    if (stdout.trim()) {
      try {
        return parseJsonFromCliOutput<T>(stdout, `openclaw ${args.join(" ")} --json`);
      } catch {
        // Fall through to original error.
      }
    }
    throw err;
  }
}

export async function gatewayCall<T>(
  method: string,
  params?: Record<string, unknown>,
  timeout = 15000
): Promise<T> {
  const args = ["gateway", "call", method, "--json"];
  if (params) args.push("--params", JSON.stringify(params));
  if (timeout > 10000) args.push("--timeout", String(timeout));
  const stdout = await runCli(args, timeout + 5000);
  return parseJsonFromCliOutput<T>(stdout, `openclaw gateway call ${method}`);
}
