import { z } from "zod";
import { FlufClient } from "../client.js";

// FLUF's support inbox. Lives client-side only because the chatroom endpoint
// requires an explicit recipient; it should move server-side (so routing can
// change without a package release) when the public API gains a support endpoint.
const FLUF_SUPPORT_INBOX = 41;

/**
 * ── Why this file is aggressively terse ──────────────────────────────────────
 *
 * A bug report lands as a DIRECT MESSAGE in a human support inbox, sitting in
 * the same thread as the seller's own messages. Agents left to their own devices
 * write these as incident write-ups: one seller's agent (Aug 2026) filed
 * reports running to ~1,200 characters over six paragraphs — narrative framing,
 * restated tool transcripts, a rationale section, a risk assessment — for facts
 * that fit in four lines. A human has to read every one of them, and the signal
 * (which item, which channel, what went wrong) was buried each time.
 *
 * Prompting for brevity is not enough on its own: the model writes what it wants
 * and only the schema is binding. So brevity is enforced STRUCTURALLY, in three
 * layers, and all three matter:
 *
 *   1. `.max()` on each field — the model is told the ceiling up front, and an
 *      over-long argument is rejected by the client before it is ever sent.
 *   2. `clamp()` — a hard truncation applied to whatever does arrive. Some
 *      clients coerce rather than reject, and a report that survives validation
 *      must still be short. Truncation is visible (an ellipsis), never silent.
 *   3. No section headers in the rendered message. "Description:" / "Context:"
 *      on their own lines invite prose to fill them; a flat set of short lines
 *      does not.
 *
 * If you raise a limit here, you are choosing to make the support inbox harder
 * to read. The fix for "it didn't fit" is a narrower report, not a bigger cap.
 */

/** Hard ceilings. Also the numbers quoted to the model in the descriptions below. */
const LIMITS = { title: 100, description: 500, context: 500 } as const;

/** Truncate to `max`, marking the cut so nobody reads a severed sentence as the whole fact. */
function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\n{3,}/g, "\n\n").trim();
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max - 1).trimEnd() + "…";
}

export const reportBugSchema = {
  title: z
    .string()
    .min(3)
    .max(LIMITS.title)
    .describe("One line naming the broken thing. No preamble, no severity word."),
  description: z
    .string()
    .min(10)
    .max(LIMITS.description)
    .describe(
      `What broke and what you expected instead. HARD LIMIT ${LIMITS.description} characters — ` +
        "aim for two or three sentences. This is a support DM a person reads, not an " +
        "incident report: no background, no restating the conversation, no rationale for " +
        "why it matters, no summary of what you already tried."
    ),
  context: z
    .string()
    .max(LIMITS.context)
    .optional()
    .describe(
      `Identifiers and raw error text only — FID/EID/VID, channel, listing id, the exact ` +
        `error string, a URL. One per line, no sentences. HARD LIMIT ${LIMITS.context} characters.`
    ),
  severity: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .describe("How blocking is this for the user. Default: medium."),
};

export const reportBugDescription =
  "Raise a bug with FLUF support. Two situations call for it, and the second is " +
  "the one that gets missed:\n" +
  "1. The user describes a problem with FLUF that you can't resolve yourself.\n" +
  "2. YOU hit the problem — a FLUF tool keeps failing, returns something that " +
  "contradicts itself or the user's account, or leaves you unable to finish the " +
  "task. The user never has to mention it first, and being stuck is not a reason " +
  "to keep retrying quietly. File the report, then tell the user what you filed.\n" +
  "KEEP IT SHORT. This arrives as a direct message in a human inbox: a title, two " +
  "or three sentences, and the identifiers. Long reports get read last. " +
  "Don't file for things the user can fix themselves (expired token, lapsed plan, " +
  "a channel needing reauthorisation) — tell them the fix instead. Their account " +
  "identity is attached automatically — don't ask for it. Replies arrive in the " +
  "user's FLUF inbox.";

export async function runReportBug(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof reportBugSchema>>
) {
  const severity = args.severity ?? "medium";

  // Flat, header-less layout: "[Bug · high] <title>" then the facts. Headers were
  // what the long reports hung their paragraphs from.
  const lines = [
    `[Bug · ${severity}] ${clamp(args.title, LIMITS.title)}`,
    clamp(args.description, LIMITS.description),
  ];
  const context = args.context ? clamp(args.context, LIMITS.context) : "";
  if (context) lines.push(context);
  const message = lines.join("\n");

  const result = await client.request<{
    success?: boolean;
    message?: { id: number };
  }>("POST", "/wp-json/fc/v1/chatroom/send-direct", {
    recipient_id: FLUF_SUPPORT_INBOX,
    message,
    message_type: "text",
  });

  const messageId = result?.message?.id;
  return {
    sent: true,
    recipient_user_id: FLUF_SUPPORT_INBOX,
    message_id: messageId ?? null,
    note: "The FLUF team has been notified. Reply will arrive in the user's FLUF inbox.",
  };
}
