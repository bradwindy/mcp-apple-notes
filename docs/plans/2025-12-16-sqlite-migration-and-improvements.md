# MCP Apple Notes: SQLite Migration & Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the permission issue preventing Claude Desktop from accessing Apple Notes, then implement the README TODOs and package for distribution.

**Architecture:** Replace JXA/AppleScript automation (which requires Automation permission that Claude Desktop can't get) with direct SQLite database access. Apple Notes stores data in `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite` with gzip-compressed protobuf content. This requires Full Disk Access (which the user has granted) but bypasses AppleScript entirely.

**Tech Stack:** TypeScript/Bun, better-sqlite3, pako (gzip), protobufjs (for decoding Apple's protobuf format), LanceDB (vector store)

---

## Phase 1: Core Permission Fix (SQLite Migration)

### Task 1: Add SQLite Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add required dependencies**

```json
{
  "dependencies": {
    "@ai-sdk/openai": "^1.0.8",
    "@huggingface/transformers": "^3.1.2",
    "@lancedb/lancedb": "^0.14.0",
    "@langchain/textsplitters": "^0.1.0",
    "@modelcontextprotocol/sdk": "^1.0.3",
    "better-sqlite3": "^11.6.0",
    "pako": "^2.1.0",
    "turndown": "^7.2.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/pako": "^2.0.3",
    "@types/turndown": "^5.0.5"
  }
}
```

**Step 2: Install dependencies**

Run: `cd /Users/bradley/Developer/mcp-apple-notes && bun install`
Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "feat: add SQLite and compression dependencies for direct database access"
```

---

### Task 2: Create Apple Notes Database Reader Module

**Files:**
- Create: `src/apple-notes-db.ts`

**Step 1: Write the failing test**

Create `src/apple-notes-db.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { AppleNotesDB } from "./apple-notes-db";

describe("AppleNotesDB", () => {
  test("should connect to database", () => {
    const db = new AppleNotesDB();
    expect(db).toBeDefined();
    db.close();
  });

  test("should list notes", () => {
    const db = new AppleNotesDB();
    const notes = db.listNotes();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBeGreaterThan(0);
    db.close();
  });

  test("should get note by title", () => {
    const db = new AppleNotesDB();
    const notes = db.listNotes();
    if (notes.length > 0) {
      const note = db.getNoteByTitle(notes[0].title);
      expect(note).toBeDefined();
      expect(note?.title).toBe(notes[0].title);
    }
    db.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/bradley/Developer/mcp-apple-notes && bun test src/apple-notes-db.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

Create `src/apple-notes-db.ts`:

```typescript
import Database from "better-sqlite3";
import * as pako from "pako";
import * as path from "path";
import * as os from "os";

export interface AppleNote {
  id: number;
  title: string;
  snippet: string;
  content: string;
  creationDate: Date;
  modificationDate: Date;
  folderId: number | null;
  folderName: string | null;
}

export interface NoteListItem {
  id: number;
  title: string;
  snippet: string;
  modificationDate: Date;
}

export class AppleNotesDB {
  private db: Database.Database;
  private static DB_PATH = path.join(
    os.homedir(),
    "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
  );

  constructor(dbPath?: string) {
    const actualPath = dbPath || AppleNotesDB.DB_PATH;
    this.db = new Database(actualPath, { readonly: true });
  }

  /**
   * Convert Apple's Core Data timestamp to JavaScript Date
   * Apple uses seconds since 2001-01-01 00:00:00 UTC
   */
  private coreDataTimestampToDate(timestamp: number | null): Date {
    if (!timestamp) return new Date(0);
    // Core Data epoch is 2001-01-01 00:00:00 UTC
    const coreDataEpoch = Date.UTC(2001, 0, 1, 0, 0, 0);
    return new Date(coreDataEpoch + timestamp * 1000);
  }

  /**
   * Parse gzipped protobuf note content to extract text
   * Apple Notes uses a proprietary protobuf format
   */
  private parseNoteContent(data: Buffer | null): string {
    if (!data) return "";

    try {
      // Check for gzip magic bytes (1F 8B)
      if (data[0] === 0x1f && data[1] === 0x8b) {
        const decompressed = pako.ungzip(data);
        // The decompressed data is a protobuf
        // Extract text by finding string-like sequences
        // Apple's protobuf has the text at specific field positions
        return this.extractTextFromProtobuf(Buffer.from(decompressed));
      }
      return data.toString("utf-8");
    } catch (error) {
      console.error("Error parsing note content:", error);
      return "";
    }
  }

  /**
   * Extract readable text from Apple Notes protobuf
   * This is a simplified parser that extracts the main text content
   */
  private extractTextFromProtobuf(data: Buffer): string {
    // Apple Notes protobuf structure:
    // Field 2 (string): Note text content
    // We'll do a simple extraction looking for UTF-8 text
    try {
      const text: string[] = [];
      let i = 0;

      while (i < data.length) {
        // Look for wire type 2 (length-delimited, which includes strings)
        const byte = data[i];
        const wireType = byte & 0x07;
        const fieldNumber = byte >> 3;

        if (wireType === 2 && i + 1 < data.length) {
          // Read varint length
          let length = 0;
          let shift = 0;
          let j = i + 1;

          while (j < data.length && (data[j] & 0x80) !== 0) {
            length |= (data[j] & 0x7f) << shift;
            shift += 7;
            j++;
          }
          if (j < data.length) {
            length |= (data[j] & 0x7f) << shift;
            j++;
          }

          // Check if this looks like text (field 2 is typically the note text)
          if (fieldNumber === 2 && length > 0 && length < 100000 && j + length <= data.length) {
            const possibleText = data.slice(j, j + length).toString("utf-8");
            // Filter for actual readable text
            if (possibleText.length > 0 && /^[\x20-\x7E\n\r\t\u00A0-\uFFFF]+$/.test(possibleText)) {
              text.push(possibleText);
            }
          }
          i = j + length;
        } else {
          i++;
        }
      }

      return text.join("\n").trim();
    } catch (error) {
      // Fallback: extract any UTF-8 looking sequences
      return this.extractTextFallback(data);
    }
  }

  /**
   * Fallback text extraction - finds readable text sequences
   */
  private extractTextFallback(data: Buffer): string {
    const str = data.toString("utf-8", 0, data.length);
    // Remove binary garbage, keep readable text
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * List all notes (titles only, for efficiency)
   */
  listNotes(): NoteListItem[] {
    const stmt = this.db.prepare(`
      SELECT
        Z_PK as id,
        ZTITLE1 as title,
        ZSNIPPET as snippet,
        ZMODIFICATIONDATE1 as modificationDate
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE ZTITLE1 IS NOT NULL
        AND (ZMARKEDFORDELETION IS NULL OR ZMARKEDFORDELETION != 1)
      ORDER BY ZMODIFICATIONDATE1 DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title || "Untitled",
      snippet: row.snippet || "",
      modificationDate: this.coreDataTimestampToDate(row.modificationDate),
    }));
  }

  /**
   * Get full note details by title
   */
  getNoteByTitle(title: string): AppleNote | null {
    const stmt = this.db.prepare(`
      SELECT
        n.Z_PK as id,
        n.ZTITLE1 as title,
        n.ZSNIPPET as snippet,
        n.ZCREATIONDATE1 as creationDate,
        n.ZMODIFICATIONDATE1 as modificationDate,
        n.ZFOLDER as folderId,
        d.ZDATA as content
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICNOTEDATA d ON d.ZNOTE = n.Z_PK
      WHERE n.ZTITLE1 = ?
        AND (n.ZMARKEDFORDELETION IS NULL OR n.ZMARKEDFORDELETION != 1)
      LIMIT 1
    `);

    const row = stmt.get(title) as any;
    if (!row) return null;

    return {
      id: row.id,
      title: row.title || "Untitled",
      snippet: row.snippet || "",
      content: this.parseNoteContent(row.content),
      creationDate: this.coreDataTimestampToDate(row.creationDate),
      modificationDate: this.coreDataTimestampToDate(row.modificationDate),
      folderId: row.folderId,
      folderName: null, // TODO: Join with folder table
    };
  }

  /**
   * Get all notes with full content (for indexing)
   */
  getAllNotesWithContent(): AppleNote[] {
    const stmt = this.db.prepare(`
      SELECT
        n.Z_PK as id,
        n.ZTITLE1 as title,
        n.ZSNIPPET as snippet,
        n.ZCREATIONDATE1 as creationDate,
        n.ZMODIFICATIONDATE1 as modificationDate,
        n.ZFOLDER as folderId,
        d.ZDATA as content
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICNOTEDATA d ON d.ZNOTE = n.Z_PK
      WHERE n.ZTITLE1 IS NOT NULL
        AND (n.ZMARKEDFORDELETION IS NULL OR n.ZMARKEDFORDELETION != 1)
      ORDER BY n.ZMODIFICATIONDATE1 DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title || "Untitled",
      snippet: row.snippet || "",
      content: this.parseNoteContent(row.content),
      creationDate: this.coreDataTimestampToDate(row.creationDate),
      modificationDate: this.coreDataTimestampToDate(row.modificationDate),
      folderId: row.folderId,
      folderName: null,
    }));
  }

  /**
   * Search notes by text (simple LIKE search)
   */
  searchNotes(query: string): NoteListItem[] {
    const stmt = this.db.prepare(`
      SELECT
        Z_PK as id,
        ZTITLE1 as title,
        ZSNIPPET as snippet,
        ZMODIFICATIONDATE1 as modificationDate
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE ZTITLE1 IS NOT NULL
        AND (ZMARKEDFORDELETION IS NULL OR ZMARKEDFORDELETION != 1)
        AND (ZTITLE1 LIKE ? OR ZSNIPPET LIKE ?)
      ORDER BY ZMODIFICATIONDATE1 DESC
      LIMIT 50
    `);

    const pattern = `%${query}%`;
    const rows = stmt.all(pattern, pattern) as any[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title || "Untitled",
      snippet: row.snippet || "",
      modificationDate: this.coreDataTimestampToDate(row.modificationDate),
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/bradley/Developer/mcp-apple-notes && bun test src/apple-notes-db.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/
git commit -m "feat: add SQLite-based Apple Notes database reader

- Direct database access bypasses AppleScript permission issues
- Parses gzip-compressed protobuf note content
- Supports list, get by title, search, and full export operations"
```

---

### Task 3: Update Main Index to Use SQLite

**Files:**
- Modify: `index.ts`

**Step 1: Write test for new implementation**

The existing tests in `index.test.ts` should continue to work. Run them first to establish baseline.

Run: `cd /Users/bradley/Developer/mcp-apple-notes && bun test index.test.ts`
Expected: Note the current state (may fail due to JXA)

**Step 2: Replace JXA with SQLite in index.ts**

Key changes:
1. Remove `run-jxa` import
2. Import `AppleNotesDB` from `./src/apple-notes-db`
3. Replace `getNotes()` function
4. Replace `getNoteDetailsByTitle()` function
5. Update `indexNotes()` to use new functions
6. Note: Keep `createNote()` using JXA for now (writing requires AppleScript)

```typescript
// At the top, replace run-jxa import:
import { AppleNotesDB } from "./src/apple-notes-db";

// Replace getNotes function:
const getNotes = async (): Promise<string[]> => {
  const db = new AppleNotesDB();
  try {
    const notes = db.listNotes();
    return notes.map((n) => n.title);
  } finally {
    db.close();
  }
};

// Replace getNoteDetailsByTitle function:
const getNoteDetailsByTitle = async (title: string) => {
  const db = new AppleNotesDB();
  try {
    const note = db.getNoteByTitle(title);
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
    db.close();
  }
};
```

**Step 3: Run tests**

Run: `cd /Users/bradley/Developer/mcp-apple-notes && bun test`
Expected: Tests pass

**Step 4: Test manually**

Run: `cd /Users/bradley/Developer/mcp-apple-notes && bun run start`
Expected: Server starts without errors

**Step 5: Commit**

```bash
git add index.ts
git commit -m "feat: switch from JXA to SQLite for reading notes

- Notes are now read directly from SQLite database
- Bypasses macOS Automation permission issues
- Creating notes still uses JXA (requires user interaction)"
```

---

### Task 4: Test with Claude Desktop

**Files:**
- None (configuration test)

**Step 1: Update Claude Desktop config if needed**

Ensure `/Users/bradley/Library/Application Support/Claude/claude_desktop_config.json` has:

```json
{
  "mcpServers": {
    "local-machine": {
      "command": "/Users/bradley/.bun/bin/bun",
      "args": ["/Users/bradley/Developer/mcp-apple-notes/index.ts"]
    }
  }
}
```

**Step 2: Restart Claude Desktop**

Close and reopen Claude Desktop

**Step 3: Test list-notes**

Ask Claude: "List my notes"
Expected: Should return list of note titles

**Step 4: Test get-note**

Ask Claude: "Get the note titled 'Greenstone Caples Notes'"
Expected: Should return note content

**Step 5: Test index-notes**

Ask Claude: "Index my notes"
Expected: Should index notes without the syntax error

**Step 6: Test search**

Ask Claude: "Search my notes for 'trip'"
Expected: Should return matching notes

**Step 7: Commit version bump**

```bash
git add -A
git commit -m "chore: version 1.1.0 - SQLite database access"
```

---

### Task 4.5: Automatic Indexing on Search/Get

**Files:**
- Modify: `index.ts`

**Step 1: Create index status check helper**

Add a helper function to check if the index exists and has data:

```typescript
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
```

**Step 2: Create ensure-indexed helper**

Add a helper that indexes if needed:

```typescript
const ensureIndexed = async (): Promise<void> => {
  const ready = await isIndexReady();
  if (!ready) {
    // Perform indexing silently
    await indexNotes();
  }
};
```

**Step 3: Update search-notes handler**

Modify the `search-notes` handler to call `ensureIndexed()` before searching:

```typescript
if (name === "search-notes") {
  await ensureIndexed();
  // ... rest of search logic
}
```

**Step 4: Update get-note handler (optional)**

Consider if `get-note` should also check/update the index. Since `get-note` reads directly from SQLite (not the vector index), this may not be needed. However, we could update the index for just that note if it's changed.

**Step 5: Test automatic indexing**

1. Delete the LanceDB data directory
2. Try searching without explicitly indexing
3. Verify search triggers indexing automatically

**Step 6: Commit**

```bash
git add index.ts
git commit -m "feat: automatic indexing when search is triggered

- Index is created automatically on first search if not present
- Users no longer need to run index-notes manually
- Index status is checked before each search operation"
```

---

## Phase 2: README TODOs

### Task 5: HTML to Markdown Conversion

**Files:**
- Modify: `src/apple-notes-db.ts`
- Modify: `index.ts`

**Step 1: Note content is already plain text from protobuf**

The SQLite approach extracts plain text from the protobuf, not HTML. The HTML was only present when using JXA's `note.body()` which returns HTML.

Update the README to reflect this change.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README - SQLite returns plain text, not HTML"
```

---

### Task 6: Implement Text Chunking

**Files:**
- Create: `src/text-chunker.ts`
- Modify: `index.ts`

**Step 1: Write failing test**

Create `src/text-chunker.test.ts`:

```typescript
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
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/text-chunker.test.ts`
Expected: FAIL

**Step 3: Implement text chunker**

Create `src/text-chunker.ts`:

```typescript
export interface ChunkOptions {
  maxChunkSize: number;
  overlap: number;
}

export function chunkText(
  text: string,
  options: ChunkOptions = { maxChunkSize: 1000, overlap: 100 }
): string[] {
  const { maxChunkSize, overlap } = options;

  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);

    // Try to break at sentence boundary
    if (end < text.length) {
      const searchStart = Math.max(start + maxChunkSize - 200, start);
      const searchText = text.slice(searchStart, end);

      // Look for sentence-ending punctuation
      const sentenceEnd = searchText.search(/[.!?]\s/);
      if (sentenceEnd !== -1) {
        end = searchStart + sentenceEnd + 2;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;

    // Avoid infinite loop
    if (start >= text.length - overlap) break;
  }

  return chunks.filter((c) => c.length > 0);
}
```

**Step 4: Run tests**

Run: `bun test src/text-chunker.test.ts`
Expected: PASS

**Step 5: Integrate into index.ts**

Modify `indexNotes` to chunk notes before embedding.

**Step 6: Commit**

```bash
git add src/text-chunker.ts src/text-chunker.test.ts index.ts
git commit -m "feat: add text chunking for better embeddings

- Chunks long notes into smaller pieces for embedding
- Respects sentence boundaries when possible
- Configurable chunk size and overlap"
```

---

### Task 7: Custom Embeddings Model Option

**Files:**
- Create: `src/config.ts`
- Modify: `index.ts`

**Step 1: Create config module**

```typescript
// src/config.ts
export interface Config {
  embeddingsModel: string;
  chunkSize: number;
  chunkOverlap: number;
  dbPath: string;
}

export function loadConfig(): Config {
  return {
    embeddingsModel: process.env.EMBEDDINGS_MODEL || "Xenova/all-MiniLM-L6-v2",
    chunkSize: parseInt(process.env.CHUNK_SIZE || "1000"),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "100"),
    dbPath: process.env.NOTES_DB_PATH || "",
  };
}
```

**Step 2: Update index.ts to use config**

**Step 3: Commit**

```bash
git add src/config.ts index.ts
git commit -m "feat: add configuration support for custom embeddings model"
```

---

### Task 8: Database Control Tools

**Files:**
- Modify: `index.ts`

**Step 1: Add purge-index tool**

Add to tools list:

```typescript
{
  name: "purge-index",
  description: "Purge the vector index and start fresh",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
}
```

**Step 2: Implement handler**

```typescript
else if (name === "purge-index") {
  await db.dropTable("notes");
  return createTextResponse("Vector index purged successfully. Run index-notes to rebuild.");
}
```

**Step 3: Add stats tool**

```typescript
{
  name: "index-stats",
  description: "Get statistics about the indexed notes",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
}
```

**Step 4: Commit**

```bash
git add index.ts
git commit -m "feat: add database control tools (purge-index, index-stats)"
```

---

## Phase 3: Packaging

### Task 9: Create DXT Package Structure

**Files:**
- Create: `manifest.json`
- Modify: `package.json`

**Step 1: Create manifest.json**

```json
{
  "dxt_version": "0.1",
  "name": "mcp-apple-notes",
  "display_name": "Apple Notes MCP",
  "version": "1.1.0",
  "description": "Semantic search and RAG over Apple Notes for Claude",
  "long_description": "A Model Context Protocol server that enables semantic search over your Apple Notes using local embeddings. Search, retrieve, and create notes directly from Claude conversations.",
  "author": {
    "name": "Bradley Windybank",
    "url": "https://github.com/bradwindy"
  },
  "homepage": "https://github.com/bradwindy/mcp-apple-notes",
  "keywords": ["apple", "notes", "search", "rag", "embeddings"],
  "icon": "./images/logo.png",
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {}
    }
  },
  "tools": [
    {
      "name": "list-notes",
      "description": "List all Apple Notes titles"
    },
    {
      "name": "get-note",
      "description": "Get full content of a note by title"
    },
    {
      "name": "search-notes",
      "description": "Semantic search across all notes"
    },
    {
      "name": "index-notes",
      "description": "Index notes for semantic search"
    },
    {
      "name": "create-note",
      "description": "Create a new Apple Note"
    }
  ],
  "compatibility": {
    "platforms": ["darwin"]
  },
  "license": "MIT"
}
```

**Step 2: Update package.json build script**

```json
{
  "scripts": {
    "build": "bun build index.ts --outfile dist/index.js --target node --minify",
    "package": "bun run build && zip -r mcp-apple-notes.dxt manifest.json dist/ images/ LICENSE README.md"
  }
}
```

**Step 3: Build and package**

Run: `bun run package`
Expected: Creates `mcp-apple-notes.dxt`

**Step 4: Commit**

```bash
git add manifest.json package.json
git commit -m "feat: add DXT packaging support for easy installation"
```

---

### Task 10: Add LICENSE and Documentation

**Files:**
- Create: `LICENSE`
- Modify: `README.md`

**Step 1: Add MIT License**

**Step 2: Update README with:**
- Installation via DXT
- Full Disk Access requirement
- Troubleshooting section
- Configuration options

**Step 3: Commit**

```bash
git add LICENSE README.md
git commit -m "docs: add LICENSE and update README for v1.1.0"
```

---

### Task 11: Final Testing and Release

**Files:**
- None

**Step 1: Run all tests**

Run: `bun test`
Expected: All pass

**Step 2: Test DXT installation**

1. Build: `bun run package`
2. Double-click `mcp-apple-notes.dxt` to install in Claude Desktop
3. Test all features

**Step 3: Create GitHub release**

```bash
git tag v1.1.0
git push origin main --tags
```

**Step 4: Upload DXT to GitHub release**

---

## Summary

**Phase 1 (Critical Fix):** Tasks 1-4 - Switch to SQLite database access
**Phase 2 (TODOs):** Tasks 5-8 - Implement README improvements
**Phase 3 (Packaging):** Tasks 9-11 - Create distributable package

**Key Dependencies:**
- better-sqlite3: SQLite database access
- pako: Gzip decompression
- Full Disk Access permission (user already has this)

**Breaking Changes:**
- Note content is now plain text (from protobuf) instead of HTML
- `create-note` still requires Notes app (uses JXA fallback)

---

**Plan complete and saved to `docs/plans/2025-12-16-sqlite-migration-and-improvements.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
