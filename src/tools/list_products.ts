import { z } from "zod";
import { FlufClient } from "../client.js";

export const listProductsSchema = {
  source: z
    .string()
    .optional()
    .describe(
      "Filter by the channel a product came FROM (e.g. 'shopify', 'depop'). " +
        "Call list_channels for the values valid on this account. Omit for all sources."
    ),
  search: z.string().optional().describe("Search by title or SKU."),
  status: z
    .enum(["active", "sold", "draft", "all"])
    .optional()
    .describe("Listing status. Default: active."),
  crosslisted_to: z
    .array(z.string())
    .optional()
    .describe("Only products already live on these channels."),
  not_on_platforms: z
    .array(z.string())
    .optional()
    .describe(
      "Only products NOT yet on these channels — the usual way to find crosslist candidates."
    ),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Results per page. Default 20, max 100."),
  page: z.number().int().min(1).optional().describe("1-indexed page. Default 1."),
};

export const listProductsDescription =
  "List the authenticated seller's FLUF products. Each row carries a `vid` — the " +
  "product handle the crosslist tool takes — plus title, price, stock, source " +
  "channel and the channels it is already live on.";

export async function runListProducts(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof listProductsSchema>>
) {
  const params = new URLSearchParams();
  if (args.source) params.set("sources", args.source);
  if (args.search) params.set("search", args.search);
  if (args.status && args.status !== "all") params.set("status", args.status);
  if (args.crosslisted_to?.length)
    params.set("crosslisted_to", args.crosslisted_to.join(","));
  if (args.not_on_platforms?.length)
    params.set("not_on_platforms", args.not_on_platforms.join(","));
  params.set("per_page", String(args.per_page ?? 20));
  params.set("page", String(args.page ?? 1));

  const res = await client.request<{
    listings?: unknown[];
    total?: number;
    pages?: number;
    current_page?: number;
  }>("GET", `/wp-json/fc/listings/v1/listings?${params}`);

  return {
    listings: res?.listings ?? [],
    total: res?.total ?? 0,
    page: res?.current_page ?? 1,
    pages: res?.pages ?? 1,
  };
}
