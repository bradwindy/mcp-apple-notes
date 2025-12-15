import { Database } from "bun:sqlite";
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
  private db: Database;
  private static DEFAULT_DB_PATH = path.join(
    os.homedir(),
    "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
  );

  constructor(dbPath?: string) {
    // Priority: explicit path > env var > default path
    const actualPath = dbPath || process.env.APPLE_NOTES_DB_PATH || AppleNotesDB.DEFAULT_DB_PATH;
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
  private parseNoteContent(data: Buffer | Uint8Array | null): string {
    if (!data) return "";

    try {
      // Handle Uint8Array from bun:sqlite
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      // Check for gzip magic bytes (1F 8B)
      if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        const decompressed = pako.ungzip(buffer);
        return this.extractTextFromProtobuf(Buffer.from(decompressed));
      }
      return buffer.toString("utf-8");
    } catch (error) {
      console.error("Error parsing note content:", error);
      return "";
    }
  }

  /**
   * Extract readable text from Apple Notes protobuf
   * Apple uses a proprietary format - we extract readable text sequences
   */
  private extractTextFromProtobuf(data: Buffer): string {
    const str = data.toString("utf-8");
    // Remove binary/control characters but keep readable text and newlines
    const lines = str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "\n")
      .replace(/\uFFFD/g, "") // Remove Unicode replacement characters
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Find where actual content ends - protobuf metadata starts with repeated short garbage lines
    const goodLines: string[] = [];
    let consecutiveGarbageCount = 0;
    const maxConsecutiveGarbage = 3;

    for (const line of lines) {
      const isGarbage = this.isGarbageLine(line);

      if (isGarbage) {
        consecutiveGarbageCount++;
        if (consecutiveGarbageCount >= maxConsecutiveGarbage) {
          // We've hit the metadata section, stop here
          break;
        }
      } else {
        // Reset counter and add any skipped lines that might have been false positives
        consecutiveGarbageCount = 0;
        goodLines.push(line);
      }
    }

    return goodLines.join("\n").trim();
  }

  /**
   * Check if a line looks like protobuf garbage rather than actual content
   */
  private isGarbageLine(line: string): boolean {
    // Very short lines with special characters are likely garbage
    if (line.length < 3) return true;

    // Lines that are mostly protobuf markers
    if (/^[*JgG,\s\d\-\.]+$/.test(line)) return true;

    // Lines with too many non-printable or unusual characters
    const cleanLine = line.replace(/[^\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF\u2000-\u206F\u2600-\u27BF\uFE00-\uFE0F\u{1F300}-\u{1F9FF}]/gu, "");
    const threshold = line.length < 10 ? 0.98 : 0.90;

    return cleanLine.length / line.length < threshold;
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
