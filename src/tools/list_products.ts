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
    .describe(
      "Listing status. Omit to get in-stock products only (a `search` with no status covers sold ones too). " +
        "'sold' = products FLUF holds as out of stock, i.e. sold on some channel; 'all' = in and out of stock. " +
        "Note that `status` is FLUF's record of what the channel last said, so a listing that has " +
        "since ended still reads 'active'. Use each row's `liveness` field to tell live from stale."
    ),
  liveness: z
    .enum(["confirmed", "unconfirmed", "unknown"])
    .optional()
    .describe(
      "Filter by whether the channel has recently confirmed the listing still exists. " +
        "Use 'confirmed' whenever you are COUNTING a seller's live catalogue or deciding " +
        "whether two rows are duplicates — it narrows `total` as well as the rows, which " +
        "`status` does not."
    ),
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
  "channel and the channels it is already live on.\n\n" +
  "IMPORTANT for audits and counts: `status` is what the channel last told FLUF, " +
  "not a live check, so an ended listing keeps reading 'active'. Each row also " +
  "carries `liveness` ('confirmed' | 'unconfirmed' | 'unknown'), `last_seen_at` and " +
  "`last_seen_age_hours` — when a channel scan last returned that listing. When " +
  "counting a seller's live catalogue, or deciding whether two rows are duplicates, " +
  "**pass `liveness: \"confirmed\"`** and say so. Do not filter the rows yourself and " +
  "quote `total` — `total` counts everything the filter did not exclude, so an " +
  "unfiltered call reports the seller's whole index history as if it were live. Two 'active' rows for the " +
  "same item are usually one listing that ended and its relist, not a duplicate — " +
  "channels mint a new listing id on relist. Never advise ending a listing on the " +
  "strength of this tool alone; tell the seller to confirm on the channel first.";

export async function runListProducts(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof listProductsSchema>>
) {
  const params = new URLSearchParams();
  if (args.source) params.set("sources", args.source);
  if (args.search) params.set("search", args.search);
  // The server defaults stock_status to 'in_stock', which hides every sold item, and no
  // index row ever carries status 'sold' — so status:"sold" and any search for a sold SKU
  // both returned 0 (a seller's agent filed it as "nothing is marked sold", Sep 2026).
  // Sold = out of stock in FLUF; a search with no status looks across both.
  if (args.status === "sold") {
    params.set("stock_status", "out_of_stock");
  } else if (args.status === "active") {
    params.set("status", "active");
    params.set("stock_status", "in_stock");
  } else if (args.status === "draft") {
    params.set("status", "draft");
  } else if (args.status === "all" || args.search) {
    params.set("stock_status", "all");
  }
  if (args.liveness) params.set("liveness", args.liveness);
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
