import { z } from "zod";
import { FlufClient } from "../client.js";

export const getOrdersSchema = {
  platform: z
    .string()
    .optional()
    .describe(
      "Filter by the channel the order came from (e.g. 'depop'). " +
        "Call list_channels for valid values. Omit for all channels."
    ),
  status: z.string().optional().describe("Filter by order status."),
  search: z.string().optional().describe("Search buyer, item or order reference."),
  date_start: z
    .string()
    .optional()
    .describe("Only orders on/after this date (YYYY-MM-DD)."),
  date_end: z
    .string()
    .optional()
    .describe("Only orders on/before this date (YYYY-MM-DD)."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Results per page. Default 25, max 100."),
  page: z.number().int().min(1).optional().describe("1-indexed page. Default 1."),
};

export const getOrdersDescription =
  "Get the seller's orders across every connected marketplace, in one unified shape.";

export async function runGetOrders(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof getOrdersSchema>>
) {
  const params = new URLSearchParams();
  if (args.platform) params.set("platform", args.platform);
  if (args.status) params.set("status", args.status);
  if (args.search) params.set("search", args.search);
  if (args.date_start) params.set("date_start", args.date_start);
  if (args.date_end) params.set("date_end", args.date_end);
  params.set("per_page", String(args.per_page ?? 25));
  params.set("page", String(args.page ?? 1));

  return client.request("GET", `/wp-json/fc/orders?${params}`);
}
