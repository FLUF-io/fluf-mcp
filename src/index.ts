#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { FlufClient, loadConfig, VERSION } from "./client.js";
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

async function main() {
  const config = loadConfig();
  const client = new FlufClient(config);

  const server = new Server(
    { name: "fluf-mcp", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.shape as z.ZodRawShape),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const parsed = z
      .object(tool.shape as z.ZodRawShape)
      .parse(request.params.arguments ?? {});
    try {
      const result = await (tool.run as (c: FlufClient, a: unknown) => Promise<unknown>)(
        client,
        parsed
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
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
