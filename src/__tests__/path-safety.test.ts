/**
 * Unit tests for path safety validation.
 * Critical security tests — these prevent path traversal attacks.
 */

import { resolve, join } from "path";

// Re-implement the safeResolvePath logic from the sessions/history/events route
// in a testable pure form.
function safeResolvePath(encodedId: string, allowedBase: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(encodedId, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const resolved = resolve(decoded);

  if (!resolved.startsWith(allowedBase + "/")) return null;
  if (!resolved.endsWith(".jsonl")) return null;

  return resolved;
}

// Re-implement the env key validation
function validateKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

const ALLOWED_BASE = "/Users/test/.openclaw/agents";

describe("safeResolvePath", () => {
  function encode(path: string): string {
    return Buffer.from(path).toString("base64url");
  }

  it("accepts a valid path inside allowedBase", () => {
    const path = `${ALLOWED_BASE}/main/sessions/abc.jsonl`;
    const encoded = encode(path);
    expect(safeResolvePath(encoded, ALLOWED_BASE)).toBe(path);
  });

  it("rejects path traversal that escapes allowedBase", () => {
    // ../../.. from agents/ goes up to ~/.openclaw/ — outside the allowed base
    const malicious = `${ALLOWED_BASE}/../../evil.jsonl`;
    const encoded = encode(malicious);
    // resolve() → /Users/test/evil.jsonl — clearly outside ALLOWED_BASE
    const result = safeResolvePath(encoded, ALLOWED_BASE);
    expect(result).toBeNull();
  });

  it("allows traversal that stays within allowedBase", () => {
    // Traversal that doesn't escape — resolves to a valid .jsonl inside agents/
    const path = `${ALLOWED_BASE}/main/sessions/../../valid.jsonl`;
    const encoded = encode(path);
    // resolve() → /Users/test/.openclaw/agents/valid.jsonl — still inside base
    const result = safeResolvePath(encoded, ALLOWED_BASE);
    // This path IS inside allowed base and ends with .jsonl, so it's allowed
    expect(result).toBe(`${ALLOWED_BASE}/valid.jsonl`);
  });

  it("rejects paths outside allowedBase", () => {
    const outside = "/etc/passwd.jsonl";
    const encoded = encode(outside);
    expect(safeResolvePath(encoded, ALLOWED_BASE)).toBeNull();
  });

  it("rejects non-.jsonl files", () => {
    const path = `${ALLOWED_BASE}/main/sessions/abc.txt`;
    const encoded = encode(path);
    expect(safeResolvePath(encoded, ALLOWED_BASE)).toBeNull();
  });

  it("rejects invalid base64", () => {
    expect(safeResolvePath("!!!not_base64!!!", ALLOWED_BASE)).toBeNull();
  });

  it("rejects empty string", () => {
    expect(safeResolvePath("", ALLOWED_BASE)).toBeNull();
  });

  it("rejects path that equals allowedBase exactly (no slash after)", () => {
    // ALLOWED_BASE itself doesn't end with .jsonl, so null
    const encoded = encode(ALLOWED_BASE);
    expect(safeResolvePath(encoded, ALLOWED_BASE)).toBeNull();
  });

  it("handles multiple nested agent directories", () => {
    const path = `${ALLOWED_BASE}/claude-code/sessions/deep/path.jsonl`;
    const encoded = encode(path);
    // This IS inside ALLOWED_BASE even with a deeper path
    expect(safeResolvePath(encoded, ALLOWED_BASE)).toBe(path);
  });
});

describe("validateKey (env var key validation)", () => {
  it("accepts standard env var names", () => {
    expect(validateKey("FOO")).toBe(true);
    expect(validateKey("GITHUB_TOKEN")).toBe(true);
    expect(validateKey("MY_KEY_123")).toBe(true);
    expect(validateKey("_PRIVATE")).toBe(true);
    expect(validateKey("camelCase")).toBe(true);
  });

  it("rejects keys starting with a digit", () => {
    expect(validateKey("1INVALID")).toBe(false);
    expect(validateKey("123")).toBe(false);
  });

  it("rejects keys with special characters", () => {
    expect(validateKey("MY-KEY")).toBe(false);
    expect(validateKey("MY.KEY")).toBe(false);
    expect(validateKey("MY KEY")).toBe(false);
    expect(validateKey("MY$KEY")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateKey("")).toBe(false);
  });

  it("rejects path traversal attempts as keys", () => {
    expect(validateKey("../../etc/passwd")).toBe(false);
    expect(validateKey("../secret")).toBe(false);
  });
});
