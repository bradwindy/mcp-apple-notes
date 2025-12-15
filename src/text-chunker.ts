export interface ChunkOptions {
  maxChunkSize: number;
  overlap: number;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 1000,
  overlap: 100,
};

/**
 * Split text into chunks respecting sentence boundaries where possible
 */
export function chunkText(
  text: string,
  options: ChunkOptions = DEFAULT_OPTIONS
): string[] {
  const { maxChunkSize, overlap } = options;

  if (!text || text.trim().length === 0) {
    return [];
  }

  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);

    // Try to break at sentence boundary (only if we're not at the end)
    if (end < text.length) {
      // Search within the last 200 chars of the chunk for a sentence end
      const searchStart = Math.max(end - 200, start);
      const searchText = text.slice(searchStart, end);

      // Look for sentence-ending punctuation followed by space
      const sentenceEnd = searchText.search(/[.!?]\s/);
      if (sentenceEnd !== -1) {
        end = searchStart + sentenceEnd + 2;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Calculate next start position
    const nextStart = end - overlap;

    // Ensure we always make forward progress
    if (nextStart <= start) {
      start = end; // Move to end of current chunk if overlap would cause no progress
    } else {
      start = nextStart;
    }

    // Break if we've processed everything
    if (end >= text.length) {
      break;
    }
  }

  return chunks;
}
