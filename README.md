# fluf-mcp — FLUF Connect for AI agents

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI
agent (Claude, Cursor, Windsurf, Cline, and anything else that speaks MCP) work a
[FLUF Connect](https://fluf.io) account: read inventory, list items across
marketplaces, read orders, and raise a support ticket.

One account, one token, every marketplace you've connected — the agent never has
to learn a per-marketplace API, and never handles your marketplace credentials.

## Tools

| Tool            | What it does |
| --------------- | ------------ |
| `list_channels` | Which marketplaces this account has connected, and which it can list to. |
| `list_products` | Your products, with the channels each one is already live on. |
| `crosslist`     | List one or more products on one or more marketplaces. |
| `get_orders`    | Your orders across every connected marketplace, in one shape. |
| `report_bug`    | Raise a bug with FLUF support on your behalf. |

## Requirements

- Node 18+
- A FLUF Connect account on an active plan (the API is a paid feature)

## Install

```bash
npm install -g fluf-mcp
```

Create a token at <https://fluf.io/connect/settings/?section=developer>. It's shown once —
store it like a password. Revoke it there any time.

## Configure

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fluf": {
      "command": "npx",
      "args": ["-y", "fluf-mcp"],
      "env": { "FLUF_API_TOKEN": "fluf_pat_..." }
    }
  }
}
```

### Claude Code

```bash
claude mcp add fluf --env FLUF_API_TOKEN=fluf_pat_... -- npx -y fluf-mcp
```

### Cursor

`~/.cursor/mcp.json` (or a per-project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "fluf": {
      "command": "npx",
      "args": ["-y", "fluf-mcp"],
      "env": { "FLUF_API_TOKEN": "fluf_pat_..." }
    }
  }
}
```

### Environment variables

| Var              | Required | Default           | Notes |
| ---------------- | -------- | ----------------- | ----- |
| `FLUF_API_TOKEN` | yes      | —                 | Your personal access token. |
| `FLUF_BASE_URL`  | no       | `https://fluf.io` | Override for staging. |

## Using it

Ask in plain language — the agent picks the tools:

> "What have I got in stock that isn't on eBay yet? List the ten cheapest."

> "Show me everything that sold last week and which channel it sold on."

Two things worth knowing:

- **Always call `list_channels` first.** The available marketplaces differ per
  account and change over time; don't hardcode a list.
- **`crosslist` is not always instant.** Some channels are handed to your own
  browser session to complete, so the response may say *queued* rather than
  *listed*. Read the per-channel status; don't assume success.

## Develop

```bash
npm install
npm run build
FLUF_API_TOKEN=... node dist/index.js
```

Smoke-test without an MCP client:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | FLUF_API_TOKEN=... node dist/index.js
```

## Support

<info@fluf.io>

## License

Proprietary — © FLUF.io. Requires a FLUF Connect account on an active plan.
