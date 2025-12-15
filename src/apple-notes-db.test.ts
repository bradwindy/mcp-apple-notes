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
