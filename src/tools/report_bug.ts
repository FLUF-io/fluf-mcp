import { z } from "zod";
import { FlufClient } from "../client.js";

// FLUF's support inbox. Lives client-side only because the chatroom endpoint
// requires an explicit recipient; it should move server-side (so routing can
// change without a package release) when the public API gains a support endpoint.
const FLUF_SUPPORT_INBOX = 41;

export const reportBugSchema = {
  title: z.string().min(3).max(200).describe("Short bug title"),
  description: z
    .string()
    .min(10)
    .max(4000)
    .describe("What went wrong, what you expected, and steps to reproduce."),
  context: z
    .string()
    .max(4000)
    .optional()
    .describe(
      "Optional extra context — URLs, channel, product ID (FID/EID/VID), error messages, screenshots referenced by URL."
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
  "Don't file for things the user can fix themselves (expired token, lapsed plan, " +
  "a channel needing reauthorisation) — tell them the fix instead. Their account " +
  "identity is attached automatically — don't ask for it. Replies arrive in the " +
  "user's FLUF inbox.";

export async function runReportBug(
  client: FlufClient,
  args: z.infer<z.ZodObject<typeof reportBugSchema>>
) {
  const severity = args.severity ?? "medium";
  const lines = [
    `[Agent bug report — severity: ${severity}]`,
    `Title: ${args.title}`,
    "",
    "Description:",
    args.description,
  ];
  if (args.context) {
    lines.push("", "Context:", args.context);
  }
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
