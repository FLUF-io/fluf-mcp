#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  FlufClient,
  FlufUserActionableError,
  loadConfig,
  VERSION,
} from "./client.js";
import { RECIPES, findRecipe } from "./prompts.js";
import {
  reportBugSchema,
  reportBugDescription,
  runReportBug,
} from "./tools/report_bug.js";
import {
  listProductsSchema,
  listProductsDescription,
  runListProducts,
} from "./tools/list_products.js";
import {
  getOrdersSchema,
  getOrdersDescription,
  runGetOrders,
} from "./tools/get_orders.js";
import {
  crosslistSchema,
  crosslistDescription,
  runCrosslist,
} from "./tools/crosslist.js";
import {
  listChannelsSchema,
  listChannelsDescription,
  runListChannels,
} from "./tools/list_channels.js";
import {
  askIntesaSchema,
  askIntesaDescription,
  runAskIntesa,
} from "./tools/ask_intesa.js";

function zodToJsonSchema(shape: z.ZodRawShape): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    const def = (schema as z.ZodTypeAny)._def;
    const isOptional = schema instanceof z.ZodOptional;
    const inner = isOptional ? def.innerType : schema;
    const description =
      (schema as z.ZodTypeAny).description ?? (inner as z.ZodTypeAny).description;
    const node: Record<string, unknown> = {};
    if (description) node.description = description;

    if (inner instanceof z.ZodString) node.type = "string";
    else if (inner instanceof z.ZodNumber) node.type = "number";
    else if (inner instanceof z.ZodBoolean) node.type = "boolean";
    else if (inner instanceof z.ZodEnum) {
      node.type = "string";
      node.enum = (inner as z.ZodEnum<[string, ...string[]]>).options;
    } else if (inner instanceof z.ZodArray) {
      node.type = "array";
      const itemDef = (inner as z.ZodArray<z.ZodTypeAny>).element;
      if (itemDef instanceof z.ZodEnum) {
        node.items = {
          type: "string",
          enum: (itemDef as z.ZodEnum<[string, ...string[]]>).options,
        };
      } else if (itemDef instanceof z.ZodString) {
        node.items = { type: "string" };
      } else {
        node.items = {};
      }
    } else {
      node.type = "string";
    }

    properties[key] = node;
    if (!isOptional) required.push(key);
  }
  return { type: "object", properties, required };
}

const TOOLS = [
  {
    name: "report_bug",
    description: reportBugDescription,
    shape: reportBugSchema,
    run: runReportBug,
  },
  {
    name: "list_products",
    description: listProductsDescription,
    shape: listProductsSchema,
    run: runListProducts,
  },
  {
    name: "get_orders",
    description: getOrdersDescription,
    shape: getOrdersSchema,
    run: runGetOrders,
  },
  {
    name: "crosslist",
    description: crosslistDescription,
    shape: crosslistSchema,
    run: runCrosslist,
  },
  {
    name: "list_channels",
    description: listChannelsDescription,
    shape: listChannelsSchema,
    run: runListChannels,
  },
  {
    name: "ask_intesa",
    description: askIntesaDescription,
    shape: askIntesaSchema,
    run: runAskIntesa,
  },
] as const;

/**
 * Server-level instructions. This is the only text an MCP client puts in front
 * of the model unprompted — everything else (tool descriptions, recipes) is
 * read only once the agent has already decided to look. So it carries the one
 * thing that has to survive an agent going wrong: knowing that `report_bug`
 * exists and that being stuck is itself the trigger. Keep it short; it is paid
 * for on every session.
 */
const INSTRUCTIONS = [
  "These tools act on the user's real FLUF Connect account — live listings on " +
    "real marketplaces. Reads are free; `crosslist` publishes, so confirm before " +
    "calling it and never re-push an item that is already `queued`.",
  "",
  "`queued` is not `failed`. Extension-first channels (Vinted, Facebook) hand " +
    "the work to the seller's own browser and legitimately sit queued for " +
    "minutes. Report queued as queued. An empty result is an answer, not a " +
    "reason to retry.",
  "",
  "If you get stuck, say so with `report_bug` — don't fail silently. Being " +
    "stuck IS the trigger: a tool that keeps erroring, a response that " +
    "contradicts the user's account, a task you cannot finish. You do not need " +
    "the user to raise it first, and you should not retry a failing call more " +
    "than twice before reporting it. Put the exact error text and the ids you " +
    "were working with in `context` — that is what makes it fixable. Then tell " +
    "the user what you filed.",
  "",
  "Exception: things the user can fix themselves — an expired API token, a " +
    "lapsed plan, a channel needing reauthorisation — are not bugs. Tell them " +
    "the fix instead of filing.",
  "",
  "`ask_intesa` is FLUF's own assistant and can see the listings log, sync " +
    "history and error text this server cannot. Ask it before concluding that " +
    "something is broken.",
].join("\n");

/**
 * Consecutive failures per tool, cleared on that tool's next success. Only used
 * to word the nudge below — an agent that has failed three times needs telling
 * more firmly than one that just failed once.
 */
const failures = new Map<string, number>();

/**
 * The line appended to a failed tool call. An error string on its own reads as
 * "try again"; agents retry until they give up and hand the user a shrug. This
 * is the moment the agent is actually stuck, so it is the moment to name
 * `report_bug` — not the tool list it read once at startup.
 */
function escalation(toolName: string, err: unknown): string {
  // Don't invite a bug report about a dead token or a lapsed plan, and don't
  // recurse when the reporting channel is itself what failed.
  if (err instanceof FlufUserActionableError) {
    return "\n\nThis is fixable by the user — tell them the fix. Don't file a bug report.";
  }
  if (toolName === "report_bug") {
    return (
      "\n\nThe bug report could not be sent. Tell the user plainly that it " +
      "didn't reach FLUF, and point them at https://fluf.io/connect chat or " +
      "support@fluf.io so the report isn't lost."
    );
  }

  const count = (failures.get(toolName) ?? 0) + 1;
  failures.set(toolName, count);

  if (count === 1) {
    return (
      "\n\nIf this isn't something you can work around, call `report_bug` with " +
      "this exact error text rather than failing silently."
    );
  }
  return (
    `\n\n\`${toolName}\` has now failed ${count} times in a row. Stop retrying — ` +
    "call `report_bug` with this exact error text, the ids you were working " +
    "with, and what you were trying to do, then tell the user what you filed."
  );
}

async function main() {
  const config = loadConfig();
  const client = new FlufClient(config);

  const server = new Server(
    { name: "fluf-mcp", version: VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.shape as z.ZodRawShape),
    })),
  }));

  // Recipes — named, argument-taking workflows over the tools above. Exposed as
  // MCP prompts so clients can surface them as slash commands; the seller asks
  // for an outcome and never has to know the tool order.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: RECIPES.map((r) => ({
      name: r.name,
      title: r.title,
      description: r.description,
      arguments: r.arguments.map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required ?? false,
      })),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const recipe = findRecipe(request.params.name);
    if (!recipe) {
      throw new Error(`Unknown recipe: ${request.params.name}`);
    }

    const args = (request.params.arguments ?? {}) as Record<string, string>;
    const missing = recipe.arguments
      .filter((a) => a.required && !String(args[a.name] ?? "").trim())
      .map((a) => a.name);
    if (missing.length) {
      throw new Error(
        `Recipe ${recipe.name} needs: ${missing.join(", ")}. ` +
          recipe.arguments
            .filter((a) => missing.includes(a.name))
            .map((a) => `${a.name} — ${a.description}`)
            .join("; ")
      );
    }

    return {
      description: recipe.description,
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: recipe.build(args) },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const parsed = z
      .object(tool.shape as z.ZodRawShape)
      .parse(request.params.arguments ?? {});
    // Name the tool on the wire so FLUF's agent-activity panel records what the
    // agent actually asked for, not a route the server has to reverse-engineer.
    // A per-call clone rather than a mutable field on `client`: MCP requests can
    // overlap on one stdio pipe, and a shared field would mislabel the loser.
    const scoped = client.forTool(tool.name);
    try {
      const result = await (tool.run as (c: FlufClient, a: unknown) => Promise<unknown>)(
        scoped,
        parsed
      );
      failures.delete(tool.name);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message + escalation(tool.name, err) }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("fluf-mcp ready on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`fluf-mcp fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
