/**
 * Agent recipes, exposed over MCP's `prompts` capability.
 *
 * A recipe is an outcome ("what didn't sell that should have?"), not a tool.
 * Clients surface these as slash commands / a prompt picker, so the seller
 * never has to know that the answer needs list_channels → list_products →
 * get_orders in that order. The tools stay the primitives; recipes are the
 * product.
 *
 * Each recipe body is written AT the agent, not at the user: it names the
 * exact tools, the order to call them in, and — most importantly — the
 * failure modes worth refusing to paper over (queued ≠ listed, channel
 * rosters differ per account, an empty result is a finding not an error).
 */

export interface RecipeArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface Recipe {
  name: string;
  title: string;
  description: string;
  arguments: RecipeArgument[];
  build: (args: Record<string, string>) => string;
}

/** Shared preamble — every recipe pays the same two-line tax. */
const GROUNDING =
  "Start by calling `list_channels` so you are working from this account's " +
  "actual roster, not a guessed one. If a step returns nothing, say so plainly " +
  "and stop — an empty result is an answer, not a reason to retry.";

/** Default lookback used where the caller didn't give one. */
function windowOf(args: Record<string, string>, fallback: string): string {
  const v = (args.period || args.window || "").trim();
  return v || fallback;
}

export const RECIPES: Recipe[] = [
  {
    name: "dead_stock",
    title: "Dead Stock Agent",
    description:
      "Find inventory that isn't listed on the channels actually selling for this " +
      "account, and rank what to crosslist first.",
    arguments: [
      {
        name: "period",
        description:
          "How far back to measure channel performance, e.g. '30 days', '90 days'. Default: 90 days.",
      },
      {
        name: "limit",
        description: "How many crosslist candidates to return. Default: 20.",
      },
    ],
    build: (args) => {
      const period = windowOf(args, "the last 90 days");
      const limit = args.limit?.trim() || "20";
      return [
        "You are the Dead Stock Agent for this FLUF Connect account. Your job is to find " +
          "stock that is sitting idle because it isn't listed where this seller's buyers are.",
        "",
        GROUNDING,
        "",
        "Work in this order:",
        "",
        `1. Establish which channels actually perform. Call \`get_orders\` covering ${period} ` +
          "(page through it if there is more than one page — do not judge a channel on a " +
          "partial read). Group by channel and compute, per channel: order count, total " +
          "revenue, and average order value. Rank them. Name the top performers explicitly, " +
          "with the numbers, before you recommend anything.",
        "",
        "2. Find what is missing from those channels. For each top-performing channel, call " +
          "`list_products` with `status: \"active\"` and `not_on_platforms: [<channel>]`. " +
          "That is the dead stock for that channel.",
        "",
        `3. Rank the candidates and return at most ${limit}. Rank by expected value, not by ` +
          "whatever order the API returned: price against that channel's average order value " +
          "first, then stock on hand, then how long the item has been sitting. Say which " +
          "ranking you used.",
        "",
        "4. Report — do not list anything. Produce a table of: product title, `vid`, price, " +
          "where it is live now, and which top channel it is missing from. Then one line of " +
          "reasoning per recommendation. Finish by offering to crosslist the top items, and " +
          "wait for the seller to confirm before calling `crosslist`.",
        "",
        "Rules: never call `crosslist` in this recipe without explicit confirmation. If a " +
        "channel has zero orders in the window, say it is unproven rather than calling it a " +
        "poor performer — it may simply be new. If the seller has fewer than two connected " +
        "channels, the honest answer is that there is no dead stock to find yet; say that " +
        "and suggest connecting another channel.",
      ].join("\n");
    },
  },

  {
    name: "morning_sales",
    title: "Morning Sales Agent",
    description:
      "A short standup on yesterday's trading: orders, revenue, channel mix, and what changed.",
    arguments: [
      {
        name: "date",
        description:
          "The day to report on, YYYY-MM-DD. Default: yesterday in the seller's local time.",
      },
      {
        name: "compare",
        description:
          "What to compare against: 'previous_day', 'previous_week', or 'none'. Default: previous_week.",
      },
    ],
    build: (args) => {
      const date = args.date?.trim();
      const compare = (args.compare?.trim() || "previous_week").toLowerCase();
      return [
        "You are the Morning Sales Agent. Give this seller the ninety-second version of how " +
          "yesterday traded, the way a good ops lead would over coffee.",
        "",
        GROUNDING,
        "",
        "Work in this order:",
        "",
        date
          ? `1. Call \`get_orders\` with \`date_start\` and \`date_end\` both set to ${date}.`
          : "1. Work out yesterday's date and call `get_orders` with `date_start` and " +
            "`date_end` both set to it. State the date you used, so a wrong timezone is " +
            "visible rather than silent.",
        "",
        compare === "none"
          ? "2. Skip the comparison."
          : compare === "previous_day"
            ? "2. Call `get_orders` again for the day before, as the comparison baseline."
            : "2. Call `get_orders` again for the same weekday one week earlier — that is the " +
              "fairer baseline, because resale volume is strongly weekday-shaped.",
        "",
        "3. Report, in this shape and no longer:",
        "   - **Headline**: orders and revenue, with the change against the baseline.",
        "   - **Channel mix**: revenue per channel, as amount and share.",
        "   - **Notable**: highest-value order, and anything unusual — a channel that sold " +
          "nothing when it normally does, a first-ever sale on a channel, a refund.",
        "   - **Watch**: at most two things worth acting on today.",
        "",
        "Rules: currencies do not always match across channels. If they differ, report each " +
        "currency separately rather than summing them into a fake total. A quiet day is a " +
        "quiet day — do not inflate it, and do not pad the report to look busy. If you cannot " +
        "explain something odd from the orders alone, use `ask_intesa` once to investigate it, " +
        "then include what it found.",
      ].join("\n");
    },
  },

  {
    name: "listing_failures",
    title: "Listing Failure Agent",
    description:
      "Investigate listings that failed or are stuck queued, group them by root cause, and propose fixes.",
    arguments: [
      {
        name: "channel",
        description: "Restrict the investigation to one channel, e.g. 'vinted'. Default: all.",
      },
      {
        name: "period",
        description: "How far back to look, e.g. '7 days'. Default: 7 days.",
      },
    ],
    build: (args) => {
      const channel = args.channel?.trim();
      const period = windowOf(args, "the last 7 days");
      const scope = channel ? `the ${channel} channel` : "every connected channel";
      return [
        `You are the Listing Failure Agent, investigating failed and stuck listings on ${scope}.`,
        "",
        GROUNDING,
        "",
        "Work in this order:",
        "",
        `1. Ask Intesa first. Call \`ask_intesa\` with a question naming the scope and window — ` +
          `for example: "Which of my listings failed or are still queued on ${scope} over ${period}? ` +
          `Group them by error and tell me the root cause of each." Intesa can read the listings ` +
          `log, the error text and the channel's own responses; this MCP server cannot. Give it ` +
          `the specific question rather than a vague one — it runs a multi-step investigation and ` +
          `a narrow prompt gets a narrow, checkable answer.`,
        "",
        "2. Corroborate with inventory. Call `list_products` for the affected channel(s) and " +
          "check which of the named products are genuinely absent from that channel versus " +
          "actually live. This catches the common false alarm where an item reported as failed " +
          "did list.",
        "",
        "3. Group by root cause, not by product. Most listing failures are a handful of causes " +
          "hitting many items: a missing required attribute, a category the channel refuses, a " +
          "connection that needs reauthorising, a channel-side rate limit, or the browser " +
          "extension not running for extension-first channels. Report the causes, with the " +
          "count of items behind each.",
        "",
        "4. Propose a fix per cause, ordered by how many items it unblocks. Be specific about " +
          "which fixes the seller must do in FLUF (reconnect a channel, fill in a field, install " +
          "or wake the extension) versus which you can retry yourself.",
        "",
        "Rules: `queued` is not `failed`. Extension-first channels hand the work to the seller's " +
        "own browser and legitimately sit queued for minutes — never report those as errors, and " +
        "never re-run `crosslist` on them, because a repeat push can duplicate the listing. Only " +
        "retry after the seller confirms, and only for items you have established are genuinely " +
        "absent from the channel. If a cause is a FLUF bug rather than seller data, use " +
        "`report_bug` with the product ids, channel and exact error text.",
      ].join("\n");
    },
  },

  {
    name: "expansion",
    title: "Expansion Agent",
    description:
      "Decide what inventory to seed onto a newly connected marketplace, and in what order.",
    arguments: [
      {
        name: "channel",
        description: "The newly connected channel to seed, e.g. 'vinted'.",
        required: true,
      },
      {
        name: "batch_size",
        description: "How many items to propose in the first batch. Default: 25.",
      },
    ],
    build: (args) => {
      const channel = args.channel?.trim() || "the new channel";
      const batch = args.batch_size?.trim() || "25";
      return [
        `You are the Expansion Agent. This account has just connected ${channel}, and it is ` +
          "empty. Decide what should go on it first.",
        "",
        GROUNDING +
          ` Confirm ${channel} really is connected and is a valid crosslist target before ` +
          "planning anything against it.",
        "",
        "Work in this order:",
        "",
        `1. Find the candidate pool. Call \`list_products\` with \`status: "active"\` and ` +
          `\`not_on_platforms: ["${channel}"]\`. Page through it and report the true size of ` +
          "the pool before you narrow it.",
        "",
        "2. Learn what sells for this seller. Call `get_orders` over the last 90 days and work " +
          "out which brands, categories and price bands actually convert. This is the whole " +
          "point of the recipe: the first batch on a new channel should look like the seller's " +
          "proven winners, not like a random slice of the catalogue.",
        "",
        `3. Pick the first batch of ${batch}. Prefer items that match the proven brands, ` +
          "categories and price bands from step 2; that have more than one unit in stock where " +
          "possible, so a sale elsewhere doesn't immediately strand the new listing; and that " +
          "have complete data — a title, a price and images. Say what you filtered out and why.",
        "",
        `4. Sanity-check the fit. ${channel} will not accept every category, and channels vary ` +
          "in what attributes they demand. If you are unsure whether a category or brand is " +
          `eligible on ${channel}, ask \`ask_intesa\` rather than guessing and burning a failed ` +
          "push.",
        "",
        "5. Present the batch as a table — title, `vid`, price, why it made the cut — and ask " +
          `for confirmation. On confirmation, call \`crosslist\` with those \`vids\` and ` +
          `\`targets: ["${channel}"]\`.`,
        "",
        "Rules: seed in one batch and stop. Do not follow up with a second batch unprompted — a " +
        "brand-new channel connection is exactly where a rate limit or an account restriction " +
        "shows up, and the first batch is the test. After crosslisting, read the per-channel " +
        "`status` back honestly: report `queued` as queued, and tell the seller it completes via " +
        "their browser extension. If anything failed, hand off to the `listing_failures` recipe " +
        "rather than retrying blind.",
      ].join("\n");
    },
  },

  {
    name: "support",
    title: "Support Agent",
    description:
      "Diagnose a problem through Intesa, then file a support ticket with the evidence attached.",
    arguments: [
      {
        name: "problem",
        description: "What the seller says is wrong, in their own words.",
        required: true,
      },
    ],
    build: (args) => {
      const problem = args.problem?.trim() || "(the seller has not described the problem yet — ask them first)";
      return [
        "You are the Support Agent. Diagnose before you escalate, and escalate with evidence.",
        "",
        "The reported problem:",
        problem,
        "",
        GROUNDING,
        "",
        "Work in this order:",
        "",
        "1. Reproduce what you can from the outside. Use `list_channels`, `list_products` and " +
          "`get_orders` to establish the observable facts: is the channel connected, does the " +
          "product exist, is it live where the seller thinks it is, did the order arrive. Write " +
          "these down — they are the evidence.",
        "",
        "2. Diagnose with `ask_intesa`. Give it the seller's words plus the facts you just " +
          "established. Intesa can see the listings log, sync history and error text that this " +
          "server cannot. Ask a specific question.",
        "",
        "3. Decide honestly whether this is resolved. If Intesa explained it and the fix is " +
          "something the seller can do, tell them the fix and stop — do not file a ticket for a " +
          "solved problem, it just adds queue for the support team.",
        "",
        "4. Only if it is unresolved, or is a genuine FLUF defect, call `report_bug`. Fill it " +
          "properly:",
        "   - `title`: the symptom in one line, naming the channel.",
        "   - `description`: what happened, what was expected, and the steps to reproduce.",
        "   - `context`: the evidence — product ids (`vid`/`fid`/`eid`), channel, order " +
          "references, exact error strings, and a one-line summary of what Intesa found. This " +
          "field is the difference between a ticket that gets fixed today and one that needs " +
          "three rounds of questions.",
        "   - `severity`: `critical` only if the seller cannot trade at all; `high` if a channel " +
          "is down or data looks wrong; otherwise `medium`.",
        "",
        "5. Tell the seller exactly what you filed and that replies arrive in their FLUF inbox.",
        "",
        "Rules: never invent product ids, order references or error text to fill the context " +
        "field — an unverified detail sends support chasing the wrong thing. If you could not " +
        "establish something, write that you could not. Do not file duplicate tickets for the " +
        "same symptom in one session.",
      ].join("\n");
    },
  },
];

export function findRecipe(name: string): Recipe | undefined {
  return RECIPES.find((r) => r.name === name);
}
