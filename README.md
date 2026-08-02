# fluf-mcp — FLUF Connect for AI agents

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI
agent (Claude, Cursor, Windsurf, Cline, and anything else that speaks MCP) work a
[FLUF Connect](https://fluf.io) account: read inventory, list items across
marketplaces, read orders, ask FLUF's own assistant a question, and raise a
support ticket.

One account, one token, every marketplace you've connected — the agent never has
to learn a per-marketplace API, and never handles your marketplace credentials.

Six **tools** are the primitives. Five **recipes** are the outcomes — named
workflows that chain the tools in the right order, surfaced in your client as
slash commands. Most people want a recipe.

## Recipes

Recipes ship as MCP prompts. In Claude Desktop and Claude Code they appear as
slash commands; in Cursor and other clients, in the prompt picker.

| Recipe             | Outcome | Arguments |
| ------------------ | ------- | --------- |
| `dead_stock`       | Finds stock that isn't listed on the channels actually selling for you, ranked by what to crosslist first. | `period`, `limit` |
| `morning_sales`    | Yesterday's trading in ninety seconds: orders, revenue, channel mix, what changed against a fair baseline. | `date`, `compare` |
| `listing_failures` | Investigates failed and stuck listings, groups them by root cause, and proposes a fix per cause. | `channel`, `period` |
| `expansion`        | Decides what to seed onto a newly connected marketplace, chosen to match what already sells for you. | `channel` *(required)*, `batch_size` |
| `support`          | Diagnoses a problem through Intesa, then files a support ticket with the evidence attached. | `problem` *(required)* |

Every argument is optional unless marked, and every recipe has a sensible
default — `/dead_stock` on its own works.

```
/dead_stock period="30 days" limit=10
/morning_sales compare=previous_week
/expansion channel=vinted batch_size=25
```

Two things the recipes are deliberately strict about, because getting them wrong
is how an agent loses a seller's trust:

- **Nothing gets listed without confirmation.** `dead_stock` and `expansion`
  research and recommend; they call `crosslist` only after you say yes.
- **Queued is reported as queued.** Extension-first channels finish in your own
  browser, so an item can be accepted but not yet live. The recipes say so
  rather than claiming success, and they don't re-push (a repeat can duplicate
  the listing).

## Tools

| Tool            | What it does |
| --------------- | ------------ |
| `list_channels` | Which marketplaces this account has connected, and which it can list to. |
| `list_products` | Your products, with the channels each one is already live on. |
| `crosslist`     | List one or more products on one or more marketplaces. |
| `get_orders`    | Your orders across every connected marketplace, in one shape. |
| `ask_intesa`    | Ask FLUF's own assistant an open-ended question about your account — why a channel stopped syncing, what a listing error means, what sold and where. |
| `report_bug`    | Raise a bug with FLUF support on your behalf — either when you report a problem, or when the agent itself gets stuck and can't finish the job. |

## Get a token

Create one at <https://fluf.io/connect/developers> — in FLUF Connect that's
**More → Developers** in the left sidebar. It's shown once, so store it like a
password. Revoke it on the same screen any time.

You need a FLUF Connect account on an active plan; the API is a paid feature.

## Install

Two ways in. Pick the first unless you have a reason not to.

### Claude Desktop — one click, no Node (recommended)

Download **`fluf-mcp-<version>.mcpb`** from the
[latest release](https://github.com/FLUF-io/fluf-mcp/releases/latest) and open it.
Claude Desktop shows an install dialog, asks for your token in a form field, and
that's it — no terminal, no JSON, and **no Node install**: Claude Desktop ships
its own Node runtime and uses it for installed bundles.

### Everything else — npx

For Cursor, Claude Code, Windsurf, Cline, or if you'd rather manage it yourself.
**This route does need [Node](https://nodejs.org) 18+ on your machine** — the
runtime bundled with Claude Desktop is only used for installed `.mcpb` bundles,
not for `claude_desktop_config.json` entries, which spawn `command` from your
system PATH.

```bash
npm install -g fluf-mcp
```

## Configure

Only needed for the npx route — the `.mcpb` bundle configures itself.

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

Reach for a [recipe](#recipes) when you want an outcome — they encode the tool
order and the caveats. Otherwise ask in plain language and the agent picks the
tools:

> "What have I got in stock that isn't on eBay yet? List the ten cheapest."

> "Show me everything that sold last week and which channel it sold on."

> "Why did my last five Vinted listings fail?"

Three things worth knowing:

- **Always call `list_channels` first.** The available marketplaces differ per
  account and change over time; don't hardcode a list.
- **`crosslist` is not always instant.** Some channels are handed to your own
  browser session to complete, so the response may say *queued* rather than
  *listed*. Read the per-channel status; don't assume success.
- **`ask_intesa` is the slow, clever one.** It hands the question to Intesa, the
  assistant inside FLUF, which runs its own multi-step investigation before
  answering — so it can explain *why* something happened, not just report what
  is. Replies can take up to a minute. Use the direct tools for simple reads;
  reach for this when the question is diagnostic or open-ended.

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

echo '{"jsonrpc":"2.0","id":1,"method":"prompts/list"}' \
  | FLUF_API_TOKEN=... node dist/index.js
```

Recipes live in [`src/prompts.ts`](src/prompts.ts) — one entry in `RECIPES` per
recipe, no registration step. They're plain text aimed at the agent, so editing
one needs no client change.

## Support

<info@fluf.io>

## License

MIT — see [LICENSE](LICENSE). © FLUF.io.

The server itself is open; the account it talks to is not. You'll still need a FLUF
Connect account on an active plan for any of it to do anything.
