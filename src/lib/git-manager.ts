/**
 * git-manager.ts
 *
 * Git operations for the OpenClaw workspace directory using simple-git.
 * Handles log, diff, commit, rollback, and auto-commit scheduling.
 */

import { simpleGit, SimpleGit, SimpleGitOptions, DiffResult, LogResult } from "simple-git";
import { getDefaultWorkspace } from "@/lib/paths";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommitSummary = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string; // ISO 8601
};

export type FileDiff = {
  file: string;
  diff: string;
  additions: number;
  deletions: number;
};

export type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean; // uncommitted changes exist
  ahead: number;
  behind: number;
};

// ── Git client factory ────────────────────────────────────────────────────────

async function getGit(): Promise<{ git: SimpleGit; workspace: string }> {
  const workspace = await getDefaultWorkspace();
  const options: Partial<SimpleGitOptions> = {
    baseDir: workspace,
    binary: "git",
    maxConcurrentProcesses: 6,
    trimmed: false,
  };
  return { git: simpleGit(options), workspace };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getGitStatus(): Promise<GitStatus> {
  try {
    const { git } = await getGit();
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0 };

    const [status, branch] = await Promise.all([
      git.status(),
      git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "unknown"),
    ]);

    return {
      isRepo: true,
      branch: branch.trim(),
      dirty: !status.isClean(),
      ahead: status.ahead,
      behind: status.behind,
    };
  } catch {
    return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0 };
  }
}

export async function getGitLog(limit = 20): Promise<CommitSummary[]> {
  const { git } = await getGit();
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return [];

  const log: LogResult = await git.log({ maxCount: limit });
  return log.all.map((c) => ({
    hash: c.hash,
    shortHash: c.hash.slice(0, 7),
    message: c.message,
    author: c.author_name,
    date: c.date,
  }));
}

export async function getFileDiff(filePath?: string, ref?: string): Promise<FileDiff[]> {
  const { git } = await getGit();
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return [];

  let raw: string;
  const diffArgs: string[] = ["--stat", "--patch"];

  if (ref) {
    diffArgs.unshift(ref);
  } else {
    diffArgs.unshift("HEAD");
  }

  if (filePath) {
    diffArgs.push("--", filePath);
  }

  try {
    raw = await git.diff(diffArgs);
  } catch {
    return [];
  }

  if (!raw.trim()) return [];

  // Parse the diff output into per-file chunks
  const files: FileDiff[] = [];
  const chunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const fileMatch = chunk.match(/^a\/(.+?) b\/.+?\n/);
    const file = fileMatch ? fileMatch[1] : "unknown";
    const additions = (chunk.match(/^\+[^+]/gm) ?? []).length;
    const deletions = (chunk.match(/^-[^-]/gm) ?? []).length;
    files.push({ file, diff: "diff --git " + chunk, additions, deletions });
  }

  return files;
}

export async function commitWorkspace(message?: string): Promise<{ hash: string; message: string } | null> {
  const { git } = await getGit();
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return null;

  const status = await git.status();
  if (status.isClean()) return null; // nothing to commit

  const commitMessage = message ?? buildAutoCommitMessage(status.files.map((f) => f.path));

  await git.add(".");
  const result = await git.commit(commitMessage);

  return {
    hash: result.commit,
    message: commitMessage,
  };
}

export async function rollbackToCommit(ref: string): Promise<void> {
  const { git } = await getGit();
  const isRepo = await git.checkIsRepo();
  if (!isRepo) throw new Error("Not a git repository");

  // Validate the ref exists before touching anything
  await git.revparse([ref]); // throws if invalid
  await git.checkout([ref, "--", "."]);
}

// ── Auto-commit scheduler ─────────────────────────────────────────────────────

let autoCommitTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the auto-commit scheduler.
 * Commits uncommitted workspace changes every `intervalMs` (default 30 min).
 */
export function startAutoCommit(intervalMs = 30 * 60 * 1000): void {
  if (autoCommitTimer) return;
  autoCommitTimer = setInterval(async () => {
    try {
      const result = await commitWorkspace();
      if (result) {
        console.log(`[git-manager] auto-commit: ${result.hash} "${result.message}"`);
      }
    } catch (err) {
      console.error("[git-manager] auto-commit failed:", err);
    }
  }, intervalMs);
}

export function stopAutoCommit(): void {
  if (autoCommitTimer) {
    clearInterval(autoCommitTimer);
    autoCommitTimer = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function buildAutoCommitMessage(files: string[]): string {
  if (files.length === 0) return "chore: auto-commit workspace";
  if (files.length === 1) return `chore: update ${files[0]}`;
  if (files.length <= 3) return `chore: update ${files.slice(0, 3).join(", ")}`;
  return `chore: update ${files.length} workspace files`;
}
