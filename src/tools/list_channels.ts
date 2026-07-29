import { z } from "zod";
import { FlufClient } from "../client.js";

export const listChannelsSchema = {};

export const listChannelsDescription =
  "List the marketplace channels available on this account: which are already " +
  "connected, and which this seller's plan can list to. Call this before " +
  "crosslist rather than guessing channel names — the roster differs per account " +
  "and changes over time.";

export async function runListChannels(client: FlufClient) {
  // Derived from the listings endpoint (1 row is enough) so the channel roster is
  // whatever the app itself would show — nothing here to drift out of sync.
  const res = await client.request<{
    connected_channels?: string[];
    marketplace_channels?: string[];
  }>("GET", "/wp-json/fc/listings/v1/listings?per_page=1&page=1");

  const connected = res?.connected_channels ?? [];
  const marketplaces = res?.marketplace_channels ?? [];

  return {
    connected,
    // 'fluf' / 'fluf_db' are FLUF's own product store, not external marketplaces.
    crosslist_targets: marketplaces.filter(
      (c) => c !== "fluf" && c !== "fluf_db"
    ),
    note:
      connected.length === 0
        ? "No channels connected yet — connect one in FLUF Connect before crosslisting."
        : undefined,
  };
}
