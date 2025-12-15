# MCP Apple Notes

![MCP Apple Notes](./images/logo.png)

A [Model Context Protocol (MCP)](https://www.anthropic.com/news/model-context-protocol) server that enables semantic search and RAG (Retrieval Augmented Generation) over your Apple Notes. This allows AI assistants like Claude to search and reference your Apple Notes during conversations.

![MCP Apple Notes](./images/demo.png)

## Features

- 🔍 Semantic search over Apple Notes using [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on-device embeddings model
- 📝 Full-text search capabilities
- 📊 Vector storage using [LanceDB](https://lancedb.github.io/lancedb/)
- 🤖 MCP-compatible server for AI assistant integration
- 🍎 Native Apple Notes integration via direct SQLite database access
- 🔄 Automatic indexing - no manual setup required
- 🏃‍♂️ Fully local execution - no API keys needed

## Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Claude Desktop](https://claude.ai/download)
- macOS with Full Disk Access permission granted (see Installation)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/RafalWilinski/mcp-apple-notes
cd mcp-apple-notes
```

2. Install dependencies:

```bash
bun install
```

3. Grant Full Disk Access to the helper app:

   The MCP server needs to read the Apple Notes database directly. Due to macOS security, Claude Desktop subprocesses don't inherit Full Disk Access. A helper app (`NotesMCPHelper.app`) is included that you need to grant access to:

   - Open **System Settings** > **Privacy & Security** > **Full Disk Access**
   - Click the **+** button
   - Navigate to this repo and select `NotesMCPHelper.app`
   - Enable the toggle for NotesMCPHelper

## Usage

1. Open Claude desktop app and go to Settings -> Developer -> Edit Config

![Claude Desktop Settings](./images/desktop_settings.png)

2. Open the `claude_desktop_config.json` and add the following entry:

```json
{
  "mcpServers": {
    "local-machine": {
      "command": "/Users/<YOUR_USER_NAME>/mcp-apple-notes/NotesMCPHelper.app/Contents/MacOS/notes-mcp-helper",
      "args": ["/Users/<YOUR_USER_NAME>/mcp-apple-notes/index.ts"]
    }
  }
}
```

Important: Replace `<YOUR_USER_NAME>` with your actual username and update the path if you cloned the repo elsewhere.

3. Restart Claude desktop app. You should see this:

![Claude MCP Connection Status](./images/verify_installation.png)

4. Start using your notes! Just ask Claude to search your notes - indexing happens automatically on first search.

## Configuration

You can customize behavior using environment variables in your Claude Desktop config:

```json
{
  "mcpServers": {
    "local-machine": {
      "command": "/Users/<YOUR_USER_NAME>/mcp-apple-notes/NotesMCPHelper.app/Contents/MacOS/notes-mcp-helper",
      "args": ["/Users/<YOUR_USER_NAME>/mcp-apple-notes/index.ts"],
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
| `EMBEDDINGS_MODEL` | `Xenova/all-MiniLM-L6-v2` | HuggingFace model for embeddings |
| `CHUNK_SIZE` | `1000` | Maximum characters per chunk |
| `CHUNK_OVERLAP` | `100` | Overlap between chunks |
| `APPLE_NOTES_DB_PATH` | (system default) | Custom path to Notes database |

## Available Tools

The MCP server exposes the following tools to Claude:

| Tool | Description |
|------|-------------|
| `list-notes` | List all Apple Notes titles |
| `get-note` | Get full content of a note by title |
| `search-notes` | Semantic search across all notes (auto-indexes on first use) |
| `create-note` | Create a new Apple Note with HTML content |
| `index-notes` | Manually re-index all notes |
| `purge-index` | Clear the vector index to rebuild from scratch |
| `index-stats` | Get statistics about indexed notes and configuration |

## Troubleshooting

### Viewing Logs

```bash
tail -n 50 -f ~/Library/Logs/Claude/mcp-server-local-machine.log
# or
tail -n 50 -f ~/Library/Logs/Claude/mcp.log
```

### Common Issues

**"Permission denied" or empty note list:**
- Ensure NotesMCPHelper.app has Full Disk Access in System Settings
- Try removing and re-adding the app to Full Disk Access

**Index seems stale or notes not found:**
- Ask Claude to run `purge-index` then search again
- The index will rebuild automatically

**Slow first search:**
- First search downloads the embeddings model (~80MB)
- Subsequent searches are much faster

## Development

```bash
# Run tests
bun test

# Start the server directly
bun start

# Build for distribution
bun run build

# Create MCPB package
bun run pack

# Clear local vector database
bun run purge-db
```

## License

MIT - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [LanceDB](https://lancedb.github.io/lancedb/) for vector storage
- [HuggingFace Transformers](https://huggingface.co/docs/transformers.js) for on-device embeddings
- [Model Context Protocol](https://modelcontextprotocol.io/) for the MCP specification
