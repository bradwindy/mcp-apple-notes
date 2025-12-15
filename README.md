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

## Troubleshooting

To see logs:

```bash
tail -n 50 -f ~/Library/Logs/Claude/mcp-server-local-machine.log
# or
tail -n 50 -f ~/Library/Logs/Claude/mcp.log
```

## Todos

- [x] ~~Apple notes are returned in the HTML format~~ - Now using direct SQLite access which returns plain text
- [x] Chunk source content using text splitter with sentence boundary detection
- [ ] Add an option to use custom embeddings model
- [ ] More control over DB - purge, custom queries, etc.
- [x] Storing notes in Notes via Claude
- [x] Automatic indexing (no manual index-notes required)
