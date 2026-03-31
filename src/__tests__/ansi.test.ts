/**
 * Unit tests for the shared ANSI escape stripping utility.
 */

import { stripAnsi } from "@/lib/ansi";

describe("stripAnsi", () => {
  it("strips CSI color codes", () => {
    expect(stripAnsi("\x1B[38;5;145mhello\x1B[0m")).toBe("hello");
  });

  it("strips bold/underline sequences", () => {
    expect(stripAnsi("\x1B[1mbold\x1B[0m \x1B[4munderline\x1B[0m")).toBe("bold underline");
  });

  it("strips 256-color and truecolor codes", () => {
    expect(stripAnsi("\x1B[38;2;255;0;0mred\x1B[0m")).toBe("red");
    expect(stripAnsi("\x1B[48;5;22mgreen bg\x1B[0m")).toBe("green bg");
  });

  it("strips reset sequences", () => {
    expect(stripAnsi("before\x1B[0mafter")).toBe("beforeafter");
  });

  it("strips cursor movement codes", () => {
    expect(stripAnsi("\x1B[2Jcleared")).toBe("cleared");
    expect(stripAnsi("\x1B[Hhome")).toBe("home");
  });

  it("handles mixed ANSI and plain text", () => {
    const input = "\x1B[36m[INFO]\x1B[0m Starting server on \x1B[1mport 3000\x1B[0m";
    expect(stripAnsi(input)).toBe("[INFO] Starting server on port 3000");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
    expect(stripAnsi("")).toBe("");
  });

  it("handles multiple consecutive escape sequences", () => {
    expect(stripAnsi("\x1B[1m\x1B[31m\x1B[4mtext\x1B[0m")).toBe("text");
  });

  it("strips Fe escape sequences (single-byte)", () => {
    // ESC M = reverse line feed
    expect(stripAnsi("before\x1BMafter")).toBe("beforeafter");
  });
});
