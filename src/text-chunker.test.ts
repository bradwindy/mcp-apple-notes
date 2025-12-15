import { describe, test, expect } from "bun:test";
import { chunkText } from "./text-chunker";

describe("chunkText", () => {
  test("should split long text into chunks", () => {
    const longText = "a".repeat(2000);
    const chunks = chunkText(longText, { maxChunkSize: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 550)).toBe(true);
  });

  test("should not split short text", () => {
    const shortText = "Hello world";
    const chunks = chunkText(shortText, { maxChunkSize: 500, overlap: 50 });
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(shortText);
  });

  test("should respect sentence boundaries when possible", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const chunks = chunkText(text, { maxChunkSize: 30, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("should handle empty text", () => {
    const chunks = chunkText("", { maxChunkSize: 500, overlap: 50 });
    expect(chunks.length).toBe(0);
  });

  test("should use default options", () => {
    const text = "Short text";
    const chunks = chunkText(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
  });
});
