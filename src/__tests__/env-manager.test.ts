/**
 * Unit tests for env-manager.ts
 * Tests the pure .env parsing and serialization functions.
 */

import { parseDotenv, serializeDotenv, maskValue } from "@/lib/env-manager";

describe("parseDotenv", () => {
  it("parses simple key=value pairs", () => {
    const result = parseDotenv("FOO=bar\nBAZ=qux\n");
    expect(result).toEqual([
      { key: "FOO", value: "bar", raw: "FOO=bar" },
      { key: "BAZ", value: "qux", raw: "BAZ=qux" },
    ]);
  });

  it("strips double quotes from values", () => {
    const result = parseDotenv('KEY="hello world"\n');
    expect(result[0].value).toBe("hello world");
  });

  it("strips single quotes from values", () => {
    const result = parseDotenv("KEY='hello'\n");
    expect(result[0].value).toBe("hello");
  });

  it("skips blank lines", () => {
    const result = parseDotenv("\nFOO=bar\n\n");
    expect(result).toHaveLength(1);
  });

  it("skips comment lines", () => {
    const result = parseDotenv("# this is a comment\nFOO=bar\n");
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("FOO");
  });

  it("skips lines without an = sign", () => {
    const result = parseDotenv("NOEQUALS\nFOO=bar\n");
    expect(result).toHaveLength(1);
  });

  it("handles empty values", () => {
    const result = parseDotenv("EMPTY=\n");
    expect(result[0].value).toBe("");
  });

  it("handles values containing = signs", () => {
    const result = parseDotenv("TOKEN=abc=def=ghi\n");
    expect(result[0].value).toBe("abc=def=ghi");
  });

  it("returns empty array for empty input", () => {
    expect(parseDotenv("")).toEqual([]);
    expect(parseDotenv("\n\n")).toEqual([]);
  });
});

describe("serializeDotenv", () => {
  it("updates an existing key in place", () => {
    const original = "FOO=old\nBAR=baz\n";
    const updates = new Map([["FOO", "new"]]);
    const result = serializeDotenv(original, updates);
    expect(result).toContain("FOO=new");
    expect(result).toContain("BAR=baz");
    expect(result).not.toContain("FOO=old");
  });

  it("deletes a key when value is null", () => {
    const original = "FOO=bar\nBAZ=qux\n";
    const updates = new Map<string, string | null>([["FOO", null]]);
    const result = serializeDotenv(original, updates);
    expect(result).not.toContain("FOO=");
    expect(result).toContain("BAZ=qux");
  });

  it("appends a new key", () => {
    const original = "FOO=bar\n";
    const updates = new Map([["NEW_KEY", "value"]]);
    const result = serializeDotenv(original, updates);
    expect(result).toContain("FOO=bar");
    expect(result).toContain("NEW_KEY=value");
  });

  it("preserves comment lines", () => {
    const original = "# comment\nFOO=bar\n";
    const updates = new Map([["FOO", "new"]]);
    const result = serializeDotenv(original, updates);
    expect(result).toContain("# comment");
  });

  it("quotes values with spaces", () => {
    const original = "FOO=bar\n";
    const updates = new Map([["FOO", "hello world"]]);
    const result = serializeDotenv(original, updates);
    expect(result).toContain('FOO="hello world"');
  });

  it("preserves trailing newline", () => {
    const result = serializeDotenv("FOO=bar\n", new Map());
    expect(result.endsWith("\n")).toBe(true);
  });

  it("adds trailing newline when missing", () => {
    const result = serializeDotenv("FOO=bar", new Map());
    expect(result.endsWith("\n")).toBe(true);
  });

  it("handles empty original file with new key", () => {
    const result = serializeDotenv("", new Map([["KEY", "val"]]));
    expect(result).toContain("KEY=val");
  });
});

describe("maskValue", () => {
  it("masks non-empty values", () => {
    expect(maskValue("secret123")).toBe("••••••••");
    expect(maskValue("x")).toBe("••••");
  });

  it("returns empty string for empty value", () => {
    expect(maskValue("")).toBe("");
  });

  it("short values get short mask", () => {
    expect(maskValue("ab")).toBe("••••");
    expect(maskValue("abcd")).toBe("••••");
  });
});
