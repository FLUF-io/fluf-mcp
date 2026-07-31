const DEFAULT_BASE_URL = "https://fluf.io";
export const VERSION = "0.1.2";

// ⚠️ The token UI is a *query-string* section of the settings page, not a path.
// /connect/settings/tokens is NOT a route — the SPA reads ?section=, whose only
// values are developer|notifications|profile — so the old link silently landed
// people on the default tab. This is the first thing a new user ever sees.
const TOKENS_URL = "https://fluf.io/connect/settings/?section=developer";

export interface FlufClientConfig {
  baseUrl: string;
  token: string;
}

export function loadConfig(): FlufClientConfig {
  const token = process.env.FLUF_API_TOKEN;
  if (!token) {
    throw new Error(
      "FLUF_API_TOKEN environment variable is required. " +
        `Generate one at ${TOKENS_URL} ` +
        "(token format: fluf_pat_...)."
    );
  }
  return {
    baseUrl: (process.env.FLUF_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    token,
  };
}

export class FlufClient {
  constructor(private readonly config: FlufClientConfig) {}

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": `fluf-mcp/${VERSION}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const obj = (typeof data === "object" && data !== null ? data : {}) as {
        message?: string;
        error?: string;
        code?: string;
        billing_url?: string;
      };

      // A lapsed subscription is the one failure an agent can actually act on,
      // so say what it is instead of surfacing it as a generic auth failure.
      if (res.status === 403 && obj.code === "no_active_subscription") {
        throw new Error(
          `${obj.message || obj.error || "The FLUF API requires an active plan."} ` +
            `Manage your plan: ${obj.billing_url || "https://fluf.io/connect/settings/billing"}`
        );
      }

      if (res.status === 401) {
        throw new Error(
          "FLUF rejected this API token. It may have been revoked or expired — " +
            `issue a new one at ${TOKENS_URL}`
        );
      }

      const detail =
        obj.message ||
        obj.error ||
        (typeof data === "string" && data ? data : `HTTP ${res.status}`);
      throw new Error(`FLUF API ${method} ${path} failed: ${detail}`);
    }

    return data as T;
  }
}
