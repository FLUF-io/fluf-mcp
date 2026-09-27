import { z } from "zod";
import { FlufClient } from "../client.js";

export const deleteProductsSchema = {
  fluf_ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(100)
    .describe(
      "FLUF product ids to delete (e.g. [12345, 67890]). Max 100 per call. " +
        "Obtain these from list_products — it returns each product's `fluf_id` " +
        "field."
    ),
  also_delist: z
    .boolean()
    .optional()
    .describe(
      "If true, also end the listing on every marketplace the product is live on " +
        "(cannot be undone). Default false: only the FLUF record is deleted and live " +
        "marketplace listings stay up. Only set true when the user explicitly asks."
    ),
};

export const deleteProductsDescription =
  "Delete FLUF products. By default only the FLUF record is removed and every " +
  "marketplace listing is left untouched; pass `also_delist: true` to also end the " +
  "listings on every marketplace they are live on, which cannot be undone. Deleted " +
  "FLUF records go to Recently Deleted in the dashboard and can be restored for 60 " +
  "days. Always confirm with the user first and list which products will be deleted " +
  "(by title or id). Suited to sold-out or obsolete inventory. " +
  "Requires Pro plan (API tokens on lower plans are read-only and the request " +
  "will return a 403 'plan limit' error).";

export async function runDeleteProducts(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof deleteProductsSchema>>
) {
  const res = await client.request<{
    success?: boolean;
    queued?: boolean;
    queued_count?: number;
    partial_success?: boolean;
    message?: string;
    results?: Record<string, unknown>;
    errors?: string[];
  }>(
    "POST",
    "/wp-json/fc/listings/v1/bulk-delete",
    {
      fids: args.fluf_ids,
      // The fids shorthand delists from EVERY channel unless fluf_only is sent, so the
      // default (also_delist omitted) must send it. Never let "omitted" mean "delist".
      ...(args.also_delist === true ? {} : { fluf_only: true }),
    }
  );

  // Normalize the response to a consistent shape for the agent.
  const outcome = {
    success: res?.success ?? false,
    queued: res?.queued ?? false,
    queued_count: res?.queued_count ?? 0,
    partial_success: res?.partial_success ?? false,
    message: res?.message ?? "Deletion completed",
    deleted_count: 0,
    results: res?.results ?? {},
    errors: res?.errors ?? [],
  };

  // Count successful deletions from the results object.
  if (res?.results) {
    for (const [_vid, result] of Object.entries(res.results)) {
      if (typeof result === "object" && result !== null) {
        const r = result as Record<string, unknown>;
        if (
          typeof r.fluf === "object" &&
          r.fluf !== null &&
          (r.fluf as Record<string, unknown>).success === true
        ) {
          outcome.deleted_count++;
        }
      }
    }
  }

  return outcome;
}
