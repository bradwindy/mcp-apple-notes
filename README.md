# MCP Apple Notes

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables semantic search and RAG (Retrieval Augmented Generation) over your Apple Notes. This allows AI assistants like Claude to search, retrieve, and create Apple Notes during conversations.

## Features

- **Semantic Search** - Find notes by meaning, not just keywords, using on-device embeddings
- **Full-Text Search** - Traditional keyword search with hybrid ranking
- **Note Creation** - Create new Apple Notes directly from Claude
- **Automatic Indexing** - No manual setup required; indexing happens on first search
- **Fully Local** - All processing happens on your Mac; no API keys or cloud services needed
- **Vector Storage** - Uses [LanceDB](https://lancedb.github.io/lancedb/) for efficient similarity search
- **Configurable Chunking** - Customize how notes are split for better search results

## Prerequisites

- **macOS** - This MCP server only works on macOS (uses native Apple Notes database)
- **[Bun](https://bun.sh/docs/installation)** - JavaScript runtime required to run the server
- **[Claude Desktop](https://claude.ai/download)** - Or another MCP-compatible client
- **Full Disk Access** - Required to read the Apple Notes database (see Installation)

## Installation

There are two ways to install MCP Apple Notes:

### Option 1: Install from MCPB Package (Recommended)

1. Download the latest `mcp-apple-notes.mcpb` from [Releases](https://github.com/bradwindy/mcp-apple-notes/releases)

2. Extract the package to a location on your Mac:
   ```bash
   # Create installation directory
   mkdir -p ~/mcp-servers/mcp-apple-notes

   # Extract the mcpb (it's a zip file)
   unzip mcp-apple-notes.mcpb -d ~/mcp-servers/mcp-apple-notes
   ```

3. Continue to [Grant Full Disk Access](#grant-full-disk-access) below

### Option 2: Install from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/bradwindy/mcp-apple-notes
   cd mcp-apple-notes
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Continue to [Grant Full Disk Access](#grant-full-disk-access) below

### Grant Full Disk Access

The MCP server needs to read the Apple Notes SQLite database directly. Due to macOS security restrictions, Claude Desktop subprocesses don't inherit Full Disk Access permissions. A helper app (`NotesMCPHelper.app`) is included that acts as a wrapper to provide the necessary permissions.

**Where is NotesMCPHelper.app located?**

- If you installed from **MCPB**: `~/mcp-servers/mcp-apple-notes/NotesMCPHelper.app`
- If you installed from **source**: `<repo-directory>/NotesMCPHelper.app`

**Steps to grant Full Disk Access:**

1. Open **System Settings** (or System Preferences on older macOS)

2. Navigate to **Privacy & Security** → **Full Disk Access**

3. Click the **lock icon** at the bottom left and authenticate if needed

4. Click the **+** button to add a new application

5. Navigate to the `NotesMCPHelper.app` location:
   - Press `Cmd + Shift + G` to open "Go to Folder"
   - Enter the path to NotesMCPHelper.app (see locations above)
   - Select `NotesMCPHelper.app` and click **Open**

6. Ensure the toggle next to **NotesMCPHelper** is **enabled**

7. You may need to restart Claude Desktop for changes to take effect

## Configuration

### Claude Desktop Setup

1. Open Claude Desktop and navigate to **Settings** → **Developer** → **Edit Config**

2. This opens `claude_desktop_config.json`. Add the MCP server configuration:

   **If installed from MCPB:**
   ```json
   {
     "mcpServers": {
       "apple-notes": {
         "command": "/Users/<YOUR_USERNAME>/mcp-servers/mcp-apple-notes/NotesMCPHelper.app/Contents/MacOS/notes-mcp-helper",
         "args": ["/Users/<YOUR_USERNAME>/mcp-servers/mcp-apple-notes/index.ts"]
       }
     }
   }
   ```

   **If installed from source:**
   ```json
   {
     "mcpServers": {
       "apple-notes": {
         "command": "/Users/<YOUR_USERNAME>/path/to/mcp-apple-notes/NotesMCPHelper.app/Contents/MacOS/notes-mcp-helper",
         "args": ["/Users/<YOUR_USERNAME>/path/to/mcp-apple-notes/index.ts"]
       }
     }
   }
   ```

   > **Important:** Replace `<YOUR_USERNAME>` with your actual macOS username and update the path if you installed elsewhere.

3. Save the file and **restart Claude Desktop**

4. Verify the connection:
   - In Claude Desktop, you should see a hammer icon in the input area
   - Click it to see available MCP tools including `list-notes`, `search-notes`, etc.

### Environment Variables (Optional)

You can customize the server behavior by adding environment variables to your config:

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "...",
      "args": ["..."],
      "env": {
        "EMBEDDINGS_MODEL": "Xenova/all-MiniLM-L6-v2",
        "CHUNK_SIZE": "1000",
        "CHUNK_OVERLAP": "100"
      }
    }
  }
}
```

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDINGS_MODEL` | `Xenova/all-MiniLM-L6-v2` | HuggingFace model for generating embeddings |
| `CHUNK_SIZE` | `1000` | Maximum characters per chunk when splitting notes |
| `CHUNK_OVERLAP` | `100` | Character overlap between adjacent chunks |
| `APPLE_NOTES_DB_PATH` | (system default) | Custom path to Notes SQLite database |

## Usage

Once configured, you can interact with your Apple Notes through Claude:

### Searching Notes

Simply ask Claude to search your notes:

- "Search my notes for recipes with chicken"
- "Find notes about the project meeting last week"
- "What notes do I have about Python programming?"

The first search will automatically index all your notes (this may take 30 seconds to a few minutes depending on how many notes you have). Subsequent searches are fast.

### Viewing Notes

Ask Claude to retrieve specific notes:

- "Show me my note titled 'Shopping List'"
- "Get the full content of my meeting notes"

### Creating Notes

Ask Claude to create new notes:

- "Create a note called 'Todo List' with items: buy groceries, call mom, finish report"
- "Make a new note summarizing our conversation"

### Managing the Index

If your notes aren't showing up or seem outdated:

- "Rebuild the notes index" - Forces a fresh re-index of all notes
- "Show me the index statistics" - See how many notes and chunks are indexed
- "Purge the notes index" - Clears the index (will rebuild automatically on next search)

## Available Tools

The MCP server provides these tools to Claude:

| Tool | Description |
|------|-------------|
| `list-notes` | Returns titles of all Apple Notes |
| `get-note` | Retrieves full content of a specific note by title |
| `search-notes` | Semantic + full-text hybrid search across all notes |
| `create-note` | Creates a new Apple Note with HTML content |
| `index-notes` | Manually triggers re-indexing of all notes |
| `purge-index` | Clears the vector index completely |
| `index-stats` | Shows indexing statistics and configuration |

## Troubleshooting

### "Permission denied" or empty note list

- Verify `NotesMCPHelper.app` has Full Disk Access enabled in System Settings
- Try removing and re-adding the app to Full Disk Access
- Restart Claude Desktop after granting permissions

### Notes not found or search returning stale results

- Ask Claude to run `purge-index` to clear the cache
- The index will rebuild automatically on the next search
- Check `index-stats` to verify notes are being indexed

### Slow first search

- The first search downloads the embeddings model (~80MB)
- This is a one-time download; subsequent searches are fast
- Indexing time depends on the number and size of your notes

### Server not appearing in Claude Desktop

- Verify the paths in `claude_desktop_config.json` are correct
- Ensure Bun is installed and accessible from the command line
- Check logs for errors:
  ```bash
  tail -f ~/Library/Logs/Claude/mcp-server-apple-notes.log
  tail -f ~/Library/Logs/Claude/mcp.log
  ```

### Connection issues

- Restart Claude Desktop
- Verify the `NotesMCPHelper.app` executable exists:
  ```bash
  ls -la /path/to/NotesMCPHelper.app/Contents/MacOS/notes-mcp-helper
  ```

## Development

```bash
# Run tests
bun test

# Start the server directly (for debugging)
bun start

# Build for distribution
bun run build

# Create MCPB package
bun run pack

# Clear local vector database
bun run purge-db
```

### Project Structure

```
mcp-apple-notes/
├── index.ts              # Main MCP server entry point
├── src/
│   ├── apple-notes-db.ts # SQLite database access for Apple Notes
│   ├── text-chunker.ts   # Text chunking for embeddings
│   └── config.ts         # Configuration loader
├── NotesMCPHelper.app/   # macOS helper app for Full Disk Access
├── manifest.json         # MCPB package manifest
└── package.json          # Project dependencies
```

## How It Works

1. **Database Access**: Reads Apple Notes directly from the SQLite database at `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`

2. **Text Processing**: Notes are chunked into smaller pieces for better embedding quality

3. **Embeddings**: Uses the [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) model via HuggingFace Transformers to generate embeddings locally

4. **Vector Storage**: Embeddings are stored in LanceDB at `~/.mcp-apple-notes/data`

5. **Hybrid Search**: Combines vector similarity search with full-text search using Reciprocal Rank Fusion (RRF) for best results

## Support

- **Issues**: [GitHub Issues](https://github.com/bradwindy/mcp-apple-notes/issues)
- **Discussions**: [GitHub Discussions](https://github.com/bradwindy/mcp-apple-notes/discussions)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [LanceDB](https://lancedb.github.io/lancedb/) - Vector database
- [HuggingFace Transformers](https://huggingface.co/docs/transformers.js) - On-device embeddings
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- Original project by [Rafal Wilinski](https://github.com/RafalWilinski)
