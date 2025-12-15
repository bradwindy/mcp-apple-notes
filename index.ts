import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as lancedb from "@lancedb/lancedb";
import { runJxa } from "run-jxa";
import path from "node:path";
import os from "node:os";
import { AppleNotesDB } from "./src/apple-notes-db";
import { chunkText } from "./src/text-chunker";
import { loadConfig } from "./src/config";
import {
  EmbeddingFunction,
  LanceSchema,
  register,
} from "@lancedb/lancedb/embedding";
import { type Float, Float32, Utf8 } from "apache-arrow";
import { pipeline } from "@huggingface/transformers";

// Load configuration
const config = loadConfig();

const db = await lancedb.connect(
  path.join(os.homedir(), ".mcp-apple-notes", "data")
);
const extractor = await pipeline(
  "feature-extraction",
  config.embeddingsModel
);

@register("openai")
export class OnDeviceEmbeddingFunction extends EmbeddingFunction<string> {
  toJSON(): object {
    return {};
  }
  ndims() {
    return 384;
  }
  embeddingDataType(): Float {
    return new Float32();
  }
  async computeQueryEmbeddings(data: string) {
    const output = await extractor(data, { pooling: "mean" });
    return output.data as number[];
  }
  async computeSourceEmbeddings(data: string[]) {
    return await Promise.all(
      data.map(async (item) => {
        const output = await extractor(item, { pooling: "mean" });

        return output.data as number[];
      })
    );
  }
}

const func = new OnDeviceEmbeddingFunction();

const notesTableSchema = LanceSchema({
  title: func.sourceField(new Utf8()),
  content: func.sourceField(new Utf8()),
  creation_date: func.sourceField(new Utf8()),
  modification_date: func.sourceField(new Utf8()),
  vector: func.vectorField(),
});

const QueryNotesSchema = z.object({
  query: z.string(),
});

const GetNoteSchema = z.object({
  title: z.string(),
});

const server = new Server(
  {
    name: "my-apple-notes-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list-notes",
        description: "Lists just the titles of all my Apple Notes",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "index-notes",
        description:
          "Index all my Apple Notes for Semantic Search. Please tell the user that the sync takes couple of seconds up to couple of minutes depending on how many notes you have.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get-note",
        description: "Get a note full content and details by title",
        inputSchema: {
          type: "object",
          properties: {
            title: z.string(),
          },
          required: ["title"],
        },
      },
      {
        name: "search-notes",
        description: "Search for notes by title or content",
        inputSchema: {
          type: "object",
          properties: {
            query: z.string(),
          },
          required: ["query"],
        },
      },
      {
        name: "create-note",
        description:
          "Create a new Apple Note with specified title and content. Must be in HTML format WITHOUT newlines",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "purge-index",
        description:
          "Purge the vector index and start fresh. Use this if the index becomes corrupted or you want to rebuild it.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "index-stats",
        description:
          "Get statistics about the indexed notes including chunk count, note count, and index size.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

const getNotes = async (): Promise<string[]> => {
  const notesDb = new AppleNotesDB();
  try {
    const notes = notesDb.listNotes();
    return notes.map((n) => n.title);
  } finally {
    notesDb.close();
  }
};

const getNoteDetailsByTitle = async (title: string) => {
  const notesDb = new AppleNotesDB();
  try {
    const note = notesDb.getNoteByTitle(title);
    if (!note) {
      return {
        title: "",
        content: "",
        creation_date: "",
        modification_date: "",
      };
    }
    return {
      title: note.title,
      content: note.content,
      creation_date: note.creationDate.toLocaleString(),
      modification_date: note.modificationDate.toLocaleString(),
    };
  } finally {
    notesDb.close();
  }
};

export const indexNotes = async (notesTable: any) => {
  const start = performance.now();

  // Use SQLite directly for better performance
  const notesDb = new AppleNotesDB();
  try {
    const allNotesWithContent = notesDb.getAllNotesWithContent();

    // Chunk each note's content for better embeddings
    const chunks: {
      id: string;
      title: string;
      content: string;
      creation_date: string;
      modification_date: string;
    }[] = [];

    let chunkIndex = 0;
    for (const note of allNotesWithContent.filter((n) => n.title)) {
      const contentChunks = chunkText(note.content, {
        maxChunkSize: config.chunkSize,
        overlap: config.chunkOverlap,
      });

      // If no chunks (empty content), create one entry with the title
      if (contentChunks.length === 0) {
        chunks.push({
          id: `${chunkIndex++}`,
          title: note.title,
          content: note.title, // Use title as content for empty notes
          creation_date: note.creationDate.toLocaleString(),
          modification_date: note.modificationDate.toLocaleString(),
        });
      } else {
        // Create a chunk entry for each content chunk
        for (const contentChunk of contentChunks) {
          chunks.push({
            id: `${chunkIndex++}`,
            title: note.title,
            content: contentChunk,
            creation_date: note.creationDate.toLocaleString(),
            modification_date: note.modificationDate.toLocaleString(),
          });
        }
      }
    }

    await notesTable.add(chunks);

    return {
      chunks: chunks.length,
      allNotes: allNotesWithContent.length,
      time: performance.now() - start,
    };
  } finally {
    notesDb.close();
  }
};

export const createNotesTable = async (overrideName?: string) => {
  const start = performance.now();
  const notesTable = await db.createEmptyTable(
    overrideName || "notes",
    notesTableSchema,
    {
      mode: "create",
      existOk: true,
    }
  );

  const indices = await notesTable.listIndices();
  if (!indices.find((index) => index.name === "content_idx")) {
    await notesTable.createIndex("content", {
      config: lancedb.Index.fts(),
      replace: true,
    });
  }
  return { notesTable, time: performance.now() - start };
};

/**
 * Check if the index exists and has data
 */
const isIndexReady = async (): Promise<boolean> => {
  try {
    const tables = await db.tableNames();
    if (!tables.includes("notes")) return false;
    const table = await db.openTable("notes");
    const count = await table.countRows();
    return count > 0;
  } catch {
    return false;
  }
};

/**
 * Ensure notes are indexed before searching
 * If index doesn't exist or is empty, performs indexing automatically
 */
const ensureIndexed = async (): Promise<void> => {
  const ready = await isIndexReady();
  if (!ready) {
    const { notesTable } = await createNotesTable();
    await indexNotes(notesTable);
  }
};

const createNote = async (title: string, content: string) => {
  // Escape special characters and convert newlines to \n
  const escapedTitle = title.replace(/[\\'"]/g, "\\$&");
  const escapedContent = content
    .replace(/[\\'"]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");

  await runJxa(`
    const app = Application('Notes');
    const note = app.make({new: 'note', withProperties: {
      name: "${escapedTitle}",
      body: "${escapedContent}"
    }});
    
    return true
  `);

  return true;
};

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request, c) => {
  const { notesTable } = await createNotesTable();
  const { name, arguments: args } = request.params;

  try {
    if (name === "create-note") {
      const { title, content } = CreateNoteSchema.parse(args);
      await createNote(title, content);
      return createTextResponse(`Created note "${title}" successfully.`);
    } else if (name === "list-notes") {
      const titles = await getNotes();
      return createTextResponse(
        `Found ${titles.length} notes:\n\n${titles.join("\n")}`
      );
    } else if (name == "get-note") {
      try {
        const { title } = GetNoteSchema.parse(args);
        const note = await getNoteDetailsByTitle(title);

        return createTextResponse(JSON.stringify(note, null, 2));
      } catch (error) {
        return createTextResponse(error.message);
      }
    } else if (name === "index-notes") {
      const { time, chunks, report, allNotes } = await indexNotes(notesTable);
      return createTextResponse(
        `Indexed ${chunks} notes chunks in ${time}ms. You can now search for them using the "search-notes" tool.`
      );
    } else if (name === "search-notes") {
      // Auto-index if needed (no manual index-notes required)
      await ensureIndexed();
      const { query } = QueryNotesSchema.parse(args);
      const combinedResults = await searchAndCombineResults(notesTable, query);
      return createTextResponse(JSON.stringify(combinedResults));
    } else if (name === "purge-index") {
      try {
        await db.dropTable("notes");
        return createTextResponse(
          "Vector index purged successfully. The index will be rebuilt automatically on next search."
        );
      } catch (error) {
        return createTextResponse(
          "No index found to purge, or index was already empty."
        );
      }
    } else if (name === "index-stats") {
      try {
        const tables = await db.tableNames();
        if (!tables.includes("notes")) {
          return createTextResponse(
            "No index found. Search for something to trigger automatic indexing."
          );
        }
        const table = await db.openTable("notes");
        const chunkCount = await table.countRows();
        const notesDb = new AppleNotesDB();
        const totalNotes = notesDb.listNotes().length;
        notesDb.close();

        return createTextResponse(
          `Index Statistics:\n` +
            `- Indexed chunks: ${chunkCount}\n` +
            `- Total notes in Apple Notes: ${totalNotes}\n` +
            `- Embeddings model: ${config.embeddingsModel}\n` +
            `- Chunk size: ${config.chunkSize} chars\n` +
            `- Chunk overlap: ${config.chunkOverlap} chars`
        );
      } catch (error) {
        return createTextResponse(`Error getting stats: ${error.message}`);
      }
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Local Machine MCP Server running on stdio");

const createTextResponse = (text: string) => ({
  content: [{ type: "text", text }],
});

/**
 * Search for notes by title or content using both vector and FTS search.
 * The results are combined using RRF
 */
export const searchAndCombineResults = async (
  notesTable: lancedb.Table,
  query: string,
  limit = 20
) => {
  const [vectorResults, ftsSearchResults] = await Promise.all([
    (async () => {
      const results = await notesTable
        .search(query, "vector")
        .limit(limit)
        .toArray();
      return results;
    })(),
    (async () => {
      const results = await notesTable
        .search(query, "fts", "content")
        .limit(limit)
        .toArray();
      return results;
    })(),
  ]);

  const k = 60;
  const scores = new Map<string, number>();

  const processResults = (results: any[], startRank: number) => {
    results.forEach((result, idx) => {
      const key = `${result.title}::${result.content}`;
      const score = 1 / (k + startRank + idx);
      scores.set(key, (scores.get(key) || 0) + score);
    });
  };

  processResults(vectorResults, 0);
  processResults(ftsSearchResults, 0);

  const results = Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key]) => {
      const [title, content] = key.split("::");
      return { title, content };
    });

  return results;
};

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});
