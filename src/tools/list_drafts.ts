import { z } from "zod";
import { FlufClient } from "../client.js";

export const listDraftsSchema = {
  status: z
    .enum(["open", "pending_review", "failed"])
    .optional()
    .describe(
      "'failed' = a marketplace refused the listing for something an edit fixes " +
        "(size, brand, category, price, wording); 'pending_review' = the seller asked " +
        "to review that marketplace before anything goes live; 'open' (default) = both."
    ),
  channel: z
    .string()
    .optional()
    .describe(
      "Only drafts for this marketplace (e.g. 'ebay', 'vinted'). Omit for all; the " +
        "response's `by_channel` says where the drafts are."
    ),
  search: z.string().optional().describe("Match on the product title."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Results per page. Default 50, max 100."),
  page: z.number().int().min(1).optional().describe("1-indexed page. Default 1."),
};

export const listDraftsDescription =
  "List the seller's review drafts: listings FLUF has prepared but not sent. A " +
  "`failed` draft is one a marketplace refused for a reason the seller can fix — the " +
  "`reason` says what it objected to, and `fields` holds every value with `editable: " +
  "true` on the ones that can be changed (a `select` field lists its `options`). A " +
  "`pending_review` draft is simply waiting for a go-ahead. Read a draft, decide the " +
  "corrected value from the product itself (never invent one), then call " +
  "`approve_draft` with the edits. Once the item is live on that marketplace its draft " +
  "leaves this list on its own.";

export async function runListDrafts(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof listDraftsSchema>>
) {
  const params = new URLSearchParams();
  if (args.status) params.set("status", args.status);
  if (args.channel) params.set("channel", args.channel);
  if (args.search) params.set("search", args.search);
  if (args.per_page) params.set("per_page", String(args.per_page));
  if (args.page) params.set("page", String(args.page));
  const qs = params.toString();

  return client.request("GET", `/wp-json/fc/api/v1/drafts${qs ? `?${qs}` : ""}`);
}
