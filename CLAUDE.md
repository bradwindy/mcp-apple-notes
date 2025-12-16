# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Apple Notes is a Model Context Protocol (MCP) server that enables semantic search and RAG over Apple Notes. It runs locally on macOS, using on-device embeddings with LanceDB for vector storage.

## Commands

```bash
bun install        # Install dependencies
bun start          # Run the MCP server directly
bun test           # Run tests
bun run build      # Build for distribution (outputs to dist/)
bun run pack       # Create MCPB distribution package
bun run purge-db   # Clear local vector database at ~/.mcp-apple-notes
```

## Architecture

**Entry Point:** `index.ts` - Main MCP server that:
- Registers 7 MCP tools (list-notes, get-note, search-notes, create-note, index-notes, purge-index, index-stats)
- Initializes LanceDB connection at `~/.mcp-apple-notes/data`
- Loads HuggingFace embeddings model via `@huggingface/transformers`
- Implements hybrid search combining vector similarity and full-text search using Reciprocal Rank Fusion (RRF)

**Core Modules:**
- `src/apple-notes-db.ts` - Direct SQLite access to Apple Notes database at `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`. Handles gzip-compressed protobuf parsing for note content extraction.
- `src/text-chunker.ts` - Splits note content into chunks for embeddings with configurable size/overlap and sentence boundary detection
- `src/config.ts` - Environment variable configuration loader

**Note Creation:** Uses `run-jxa` to execute JavaScript for Automation (JXA) to create notes via the Notes app API.

**Permissions:** `NotesMCPHelper.app` is a macOS helper app wrapper that provides Full Disk Access to read the Notes database, since Claude Desktop subprocesses don't inherit FDA permissions.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDINGS_MODEL` | `Xenova/all-MiniLM-L6-v2` | HuggingFace model for embeddings |
| `CHUNK_SIZE` | `1000` | Max characters per chunk |
| `CHUNK_OVERLAP` | `100` | Character overlap between chunks |
| `APPLE_NOTES_DB_PATH` | (system default) | Custom path to Notes SQLite database |

## Key Implementation Details

- Apple Notes timestamps use Core Data epoch (2001-01-01) - see `coreDataTimestampToDate()` in apple-notes-db.ts
- Note content is stored as gzip-compressed protobuf - binary extraction in `parseNoteContent()`
- Search auto-indexes on first query if index doesn't exist
- Vector index uses 384-dimension embeddings from all-MiniLM-L6-v2
