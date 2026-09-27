import { z } from "zod";
import { FlufClient } from "../client.js";

export const approveDraftSchema = {
  draft_id: z
    .number()
    .int()
    .positive()
    .describe("The draft's `id` from list_drafts."),
  edits: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]))
    .optional()
    .describe(
      "Field name → new value, using the keys from the draft's `fields` (only fields " +
        "marked `editable: true`). For a `select` field send one of its `options` values; " +
        "a multi-select field (colours) takes an array of them. " +
        "Omit to send the draft exactly as it stands."
    ),
};

export const approveDraftDescription =
  "Approve a review draft and send it to the marketplace, optionally correcting fields " +
  "first — the way to resolve a `failed` draft. Read the draft with list_drafts before " +
  "calling this, take the new value from the product's own details (its measured size, " +
  "its actual brand), and confirm with the user before you send: this publishes a real " +
  "listing. `state` comes back as `listed` (live now), `pending` (accepted, publishes " +
  "shortly — do not resend) or `failed` (the marketplace refused again; `message` says " +
  "why and `draft` is the refreshed draft to try once more). Requires Pro plan (API " +
  "tokens on lower plans are read-only and the request will return a 403 'plan limit' " +
  "error).";

export async function runApproveDraft(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof approveDraftSchema>>
) {
  return client.request(
    "POST",
    `/wp-json/fc/api/v1/drafts/${args.draft_id}/approve`,
    args.edits ? { edits: args.edits } : {}
  );
}
