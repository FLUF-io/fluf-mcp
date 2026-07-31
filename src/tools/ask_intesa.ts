import { z } from "zod";
import { FlufClient } from "../client.js";

export const askIntesaSchema = {
  message: z
    .string()
    .min(1)
    .describe("What to ask or tell Intesa, in plain language."),
  conversation_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Continue an existing conversation. Omit to start a new one — the id is " +
        "returned so follow-up calls can thread onto it."
    ),
};

export const askIntesaDescription =
  "Ask Intesa, the FLUF assistant that runs inside the seller's own account. " +
  "Intesa can do things this MCP server cannot: diagnose why a channel stopped " +
  "syncing, explain a listing error, run bulk jobs, search the seller's history " +
  "and read FLUF's support docs. Prefer the direct tools (list_products, " +
  "crosslist, get_orders) for simple reads and writes — they are faster and " +
  "cheaper. Reach for this when the question is diagnostic or open-ended, e.g. " +
  "'why did my last five Vinted listings fail?'. Replies can take up to a " +
  "minute because Intesa runs its own multi-step tool loop.";

interface ChatResponse {
  success?: boolean;
  conversation_id?: number;
  assistant_message_id?: number;
  response?: string;
  tool_calls?: Array<{ name?: string; tool_name?: string }>;
  tokens_used?: number;
}

export async function runAskIntesa(
  client: FlufClient,
  args: { message: string; conversation_id?: number }
) {
  // The non-streaming /chat path is the right one here: MCP is request/response,
  // and /chat/stream's SSE frames would have to be buffered back into a single
  // string anyway. The trade-off is latency — Intesa runs up to 15 tool
  // iterations server-side before it answers.
  const res = await client.request<ChatResponse>(
    "POST",
    "/wp-json/fc/agent/v1/chat",
    {
      message: args.message,
      ...(args.conversation_id
        ? { conversation_id: args.conversation_id }
        : {}),
    }
  );

  // Surface which tools Intesa ran. Without this the caller cannot tell an
  // answer that acted on the account from one that only talked about it.
  const toolsUsed = (res.tool_calls ?? [])
    .map((t) => t.name || t.tool_name)
    .filter((n): n is string => Boolean(n));

  return {
    reply: res.response ?? "",
    conversation_id: res.conversation_id,
    tools_used: toolsUsed,
    note: res.response
      ? undefined
      : "Intesa returned an empty reply — it may have timed out mid-answer. Retry, or ask a narrower question.",
  };
}
