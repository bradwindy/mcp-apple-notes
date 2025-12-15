export interface Config {
  embeddingsModel: string;
  chunkSize: number;
  chunkOverlap: number;
  dbPath: string;
}

/**
 * Load configuration from environment variables with sensible defaults
 */
export function loadConfig(): Config {
  return {
    embeddingsModel: process.env.EMBEDDINGS_MODEL || "Xenova/all-MiniLM-L6-v2",
    chunkSize: parseInt(process.env.CHUNK_SIZE || "1000"),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "100"),
    dbPath: process.env.APPLE_NOTES_DB_PATH || "",
  };
}
