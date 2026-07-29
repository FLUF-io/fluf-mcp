import { z } from "zod";
import { FlufClient } from "../client.js";

export const crosslistSchema = {
  vids: z
    .array(z.string())
    .min(1)
    .max(50)
    .describe(
      "Product handles to crosslist, taken verbatim from the `vid` field of " +
        "list_products (e.g. 'shopify_123456_0'). Not a bare numeric id."
    ),
  targets: z
    .array(z.string())
    .min(1)
    .describe(
      "Channels to list on. Use the ids from list_channels. To target a specific " +
        "account when the seller has several on one channel, append the connection " +
        "id: 'depop:208'."
    ),
};

export const crosslistDescription =
  "List existing FLUF products on one or more marketplaces. " +
  "IMPORTANT: this is not always synchronous. Some channels are completed by the " +
  "seller's own browser extension, so they come back `queued` and go live minutes " +
  "later — report that honestly rather than telling the user the item is listed. " +
  "Read `status` per channel in the response. Repeats of the same (product, " +
  "channel) pair within 30s are ignored as accidental double-submits.";

/** Per-channel outcome, normalised so an agent doesn't have to interpret internals. */
type Outcome = "listed" | "queued" | "failed" | "unknown";

function classify(result: unknown): { status: Outcome; detail?: string } {
  if (!result || typeof result !== "object") return { status: "unknown" };
  const r = result as Record<string, unknown>;

  // Extension-first channels return type=extension_required with item_listed=false.
  // That is a SUCCESSFUL enqueue, not a failure — the distinction matters because
  // treating it as an error makes agents retry and double-list.
  if (r.queued_for_extension === true || r.type === "extension_required") {
    return { status: "queued", detail: String(r.message ?? "") };
  }
  if (r.error === true || typeof r.error === "string") {
    return {
      status: "failed",
      detail: String((r.message as string) ?? (r.error as string) ?? ""),
    };
  }
  if (r.item_listed === true) return { status: "listed" };
  if (r.type === "export_in_progress") {
    return { status: "queued", detail: "Listing in progress on the marketplace." };
  }
  return { status: "unknown", detail: String(r.message ?? "") };
}

export async function runCrosslist(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof crosslistSchema>>
) {
  const res = await client.request<Record<string, unknown>>(
    "POST",
    "/wp-json/fc/listings/v1/crosslist",
    {
      vids: args.vids,
      targets: args.targets,
      // Declares "no browser here". The server queues extension-first channels
      // instead of returning a payload for a browser tab to execute.
      origin: "mcp",
    }
  );

  // The endpoint returns a LIST of per-product entries ({vid, fid, pushData}), with
  // extras like batching_info/job_id merged in as string keys — so in JSON it arrives
  // as an object mixing numeric indices and named keys. Walk only the entries that
  // actually carry pushData rather than assuming a top-level shape.
  const products: Array<{
    vid: string;
    channels: Record<string, { status: Outcome; detail?: string }>;
  }> = [];

  for (const value of Object.values(res ?? {})) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const push = entry.pushData;
    if (!push || typeof push !== "object") continue;

    const channels: Record<string, { status: Outcome; detail?: string }> = {};
    for (const [channel, result] of Object.entries(push as Record<string, unknown>)) {
      channels[channel] = classify(result);
    }
    products.push({ vid: String(entry.vid ?? ""), channels });
  }

  const pending = [
    ...new Set(
      products.flatMap((p) =>
        Object.entries(p.channels)
          .filter(([, v]) => v.status === "queued")
          .map(([c]) => c)
      )
    ),
  ];

  return {
    products,
    ...(pending.length
      ? {
          pending,
          note:
            `Not live yet on: ${pending.join(", ")}. These are completed by the ` +
            `seller's browser extension and typically go live within a few minutes. ` +
            `Tell the user it is queued, not listed. To confirm later, re-run ` +
            `list_products — do NOT call crosslist again, as a repeat push can duplicate.`,
        }
      : {}),
    ...(res?.job_id ? { job_id: res.job_id } : {}),
  };
}
