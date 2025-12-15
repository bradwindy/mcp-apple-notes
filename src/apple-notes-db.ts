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
