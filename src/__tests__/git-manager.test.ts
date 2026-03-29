/**
 * Unit tests for git-manager.ts
 *
 * Mocks simple-git and @/lib/paths so no real git repo or filesystem is needed.
 * Tests pure helpers, status/log/diff parsing, commit/rollback logic, and
 * the auto-commit scheduler.
 */

jest.mock("simple-git");
jest.mock("@/lib/paths", () => ({
  getDefaultWorkspace: jest.fn().mockResolvedValue("/fake/workspace"),
  getOpenClawHome: jest.fn().mockReturnValue("/fake/home"),
}));

import { simpleGit } from "simple-git";
import {
  buildAutoCommitMessage,
  getGitStatus,
  getGitLog,
  getFileDiff,
  commitWorkspace,
  rollbackToCommit,
  startAutoCommit,
  stopAutoCommit,
} from "@/lib/git-manager";

// ── Mock git instance ─────────────────────────────────────────────────────────

const mockGit = {
  checkIsRepo: jest.fn(),
  status: jest.fn(),
  revparse: jest.fn(),
  log: jest.fn(),
  diff: jest.fn(),
  add: jest.fn(),
  commit: jest.fn(),
  checkout: jest.fn(),
};

(simpleGit as jest.Mock).mockReturnValue(mockGit);

beforeEach(() => {
  jest.clearAllMocks();
  stopAutoCommit(); // reset singleton timer between tests
});

// ── buildAutoCommitMessage ────────────────────────────────────────────────────

describe("buildAutoCommitMessage", () => {
  it("returns generic message for empty file list", () => {
    expect(buildAutoCommitMessage([])).toBe("chore: auto-commit workspace");
  });

  it("names the single file when only one changed", () => {
    expect(buildAutoCommitMessage(["MEMORY.md"])).toBe("chore: update MEMORY.md");
  });

  it("lists two files inline", () => {
    expect(buildAutoCommitMessage(["a.ts", "b.ts"])).toBe("chore: update a.ts, b.ts");
  });

  it("lists three files inline", () => {
    expect(buildAutoCommitMessage(["a.ts", "b.ts", "c.ts"])).toBe(
      "chore: update a.ts, b.ts, c.ts"
    );
  });

  it("uses count for four or more files", () => {
    expect(buildAutoCommitMessage(["a.ts", "b.ts", "c.ts", "d.ts"])).toBe(
      "chore: update 4 workspace files"
    );
  });

  it("uses count for many files", () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
    expect(buildAutoCommitMessage(files)).toBe("chore: update 20 workspace files");
  });
});

// ── getGitStatus ──────────────────────────────────────────────────────────────

describe("getGitStatus", () => {
  it("returns isRepo:false when not a git repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(false);
    const result = await getGitStatus();
    expect(result).toEqual({ isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0 });
  });

  it("returns clean status for up-to-date clean repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true, ahead: 0, behind: 0 });
    mockGit.revparse.mockResolvedValue("main\n");

    const result = await getGitStatus();
    expect(result).toEqual({ isRepo: true, branch: "main", dirty: false, ahead: 0, behind: 0 });
  });

  it("reports dirty:true when there are uncommitted changes", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => false, ahead: 2, behind: 0 });
    mockGit.revparse.mockResolvedValue("feature/x\n");

    const result = await getGitStatus();
    expect(result).toEqual({ isRepo: true, branch: "feature/x", dirty: true, ahead: 2, behind: 0 });
  });

  it("trims trailing whitespace from branch name", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true, ahead: 0, behind: 0 });
    mockGit.revparse.mockResolvedValue("  main  ");

    const result = await getGitStatus();
    expect(result.branch).toBe("main");
  });

  it("returns safe defaults if git throws", async () => {
    mockGit.checkIsRepo.mockRejectedValue(new Error("git not found"));
    const result = await getGitStatus();
    expect(result).toEqual({ isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0 });
  });
});

// ── getGitLog ─────────────────────────────────────────────────────────────────

describe("getGitLog", () => {
  it("returns [] when not a repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(false);
    expect(await getGitLog()).toEqual([]);
  });

  it("maps log entries to CommitSummary shape", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.log.mockResolvedValue({
      all: [
        {
          hash: "abc1234567890",
          message: "feat: add timeline",
          author_name: "Alice",
          date: "2025-01-15T10:00:00Z",
        },
        {
          hash: "def9876543210",
          message: "fix: typo",
          author_name: "Bob",
          date: "2025-01-14T09:00:00Z",
        },
      ],
    });

    const result = await getGitLog(20);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      hash: "abc1234567890",
      shortHash: "abc1234",
      message: "feat: add timeline",
      author: "Alice",
      date: "2025-01-15T10:00:00Z",
    });
    expect(result[1].shortHash).toBe("def9876");
  });

  it("passes limit to git.log", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.log.mockResolvedValue({ all: [] });
    await getGitLog(5);
    expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 5 });
  });
});

// ── getFileDiff ───────────────────────────────────────────────────────────────

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
diff --git a/README.md b/README.md
index 111..222 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-old line
+new line
`;

describe("getFileDiff", () => {
  it("returns [] when not a repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(false);
    expect(await getFileDiff()).toEqual([]);
  });

  it("returns [] when diff output is empty", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.diff.mockResolvedValue("   ");
    expect(await getFileDiff()).toEqual([]);
  });

  it("parses two-file diff into separate FileDiff entries", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.diff.mockResolvedValue(SAMPLE_DIFF);

    const result = await getFileDiff();
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("src/foo.ts");
    expect(result[0].additions).toBe(2);
    expect(result[0].deletions).toBe(1);
    expect(result[1].file).toBe("README.md");
    expect(result[1].additions).toBe(1);
    expect(result[1].deletions).toBe(1);
  });

  it("each FileDiff.diff string starts with 'diff --git'", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.diff.mockResolvedValue(SAMPLE_DIFF);
    const result = await getFileDiff();
    for (const f of result) {
      expect(f.diff).toMatch(/^diff --git /);
    }
  });

  it("passes HEAD when no ref supplied", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.diff.mockResolvedValue("");
    await getFileDiff();
    expect(mockGit.diff).toHaveBeenCalledWith(
      expect.arrayContaining(["HEAD", "--stat", "--patch"])
    );
  });

  it("passes supplied ref instead of HEAD", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.diff.mockResolvedValue("");
    await getFileDiff(undefined, "abc1234");
    expect(mockGit.diff).toHaveBeenCalledWith(
      expect.arrayContaining(["abc1234"])
    );
  });

  it("returns [] when git.diff throws", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.diff.mockRejectedValue(new Error("no commits"));
    expect(await getFileDiff()).toEqual([]);
  });
});

// ── commitWorkspace ───────────────────────────────────────────────────────────

describe("commitWorkspace", () => {
  it("returns null when not a repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(false);
    expect(await commitWorkspace()).toBeNull();
  });

  it("returns null when working tree is clean", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true, files: [] });
    expect(await commitWorkspace()).toBeNull();
  });

  it("stages all files and commits with auto-generated message", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({
      isClean: () => false,
      files: [{ path: "MEMORY.md" }, { path: "SOUL.md" }],
    });
    mockGit.add.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue({ commit: "abc1234" });

    const result = await commitWorkspace();
    expect(mockGit.add).toHaveBeenCalledWith(".");
    expect(result).toEqual({ hash: "abc1234", message: "chore: update MEMORY.md, SOUL.md" });
  });

  it("uses supplied message over auto-generated one", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({
      isClean: () => false,
      files: [{ path: "x.ts" }],
    });
    mockGit.add.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue({ commit: "deadbeef" });

    const result = await commitWorkspace("my custom message");
    expect(mockGit.commit).toHaveBeenCalledWith("my custom message");
    expect(result?.message).toBe("my custom message");
  });
});

// ── rollbackToCommit ──────────────────────────────────────────────────────────

describe("rollbackToCommit", () => {
  it("throws when not a repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(false);
    await expect(rollbackToCommit("abc1234")).rejects.toThrow("Not a git repository");
  });

  it("throws when ref is invalid (revparse rejects)", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.revparse.mockRejectedValue(new Error("unknown revision"));
    await expect(rollbackToCommit("badref")).rejects.toThrow("unknown revision");
    expect(mockGit.checkout).not.toHaveBeenCalled();
  });

  it("calls checkout with ref and -- . for a valid ref", async () => {
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.revparse.mockResolvedValue("abc1234567890\n");
    mockGit.checkout.mockResolvedValue(undefined);

    await rollbackToCommit("abc1234");
    expect(mockGit.checkout).toHaveBeenCalledWith(["abc1234", "--", "."]);
  });
});

// ── startAutoCommit / stopAutoCommit ──────────────────────────────────────────

/** Flush all pending microtasks — needed because the auto-commit callback
 *  has several chained awaits (getDefaultWorkspace → checkIsRepo → status). */
async function flushPromises() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("startAutoCommit / stopAutoCommit", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Always return a clean repo so commitWorkspace short-circuits after checkIsRepo/status
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true, files: [] });
  });

  afterEach(() => {
    stopAutoCommit();
    jest.useRealTimers();
  });

  it("does not fire before the interval elapses", () => {
    const statusSpy = jest.spyOn(mockGit, "status");
    startAutoCommit(60_000);
    jest.advanceTimersByTime(59_999);
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it("fires exactly once after one full interval", async () => {
    startAutoCommit(60_000);
    jest.advanceTimersByTime(60_000);
    await flushPromises();
    expect(mockGit.checkIsRepo).toHaveBeenCalledTimes(1);
  });

  it("fires twice after two full intervals", async () => {
    startAutoCommit(60_000);
    jest.advanceTimersByTime(60_000);
    await flushPromises();
    jest.advanceTimersByTime(60_000);
    await flushPromises();
    expect(mockGit.checkIsRepo).toHaveBeenCalledTimes(2);
  });

  it("stopAutoCommit prevents further firings", async () => {
    startAutoCommit(60_000);
    jest.advanceTimersByTime(60_000);
    await flushPromises();
    stopAutoCommit();
    jest.advanceTimersByTime(120_000);
    await flushPromises();
    // Still only 1 call — the one before stop
    expect(mockGit.checkIsRepo).toHaveBeenCalledTimes(1);
  });

  it("calling startAutoCommit twice does not create a second timer", async () => {
    startAutoCommit(60_000);
    startAutoCommit(60_000); // no-op
    jest.advanceTimersByTime(60_000);
    await flushPromises();
    expect(mockGit.checkIsRepo).toHaveBeenCalledTimes(1);
  });
});
