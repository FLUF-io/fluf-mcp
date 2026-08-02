const DEFAULT_BASE_URL = "https://fluf.io";
export const VERSION = "0.2.2";

// The token UI moved out of Settings in Aug 2026 and is now its own route,
// reachable from More → Developers in the sidebar. The old
// /connect/settings/?section=developer still redirects here, but link to the
// real route — this is the first thing a new user ever sees.
const TOKENS_URL = "https://fluf.io/connect/developers";

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

/**
 * A failure the *user* can fix (dead token, lapsed plan) rather than a FLUF
 * defect. Tagged so the tool-call handler doesn't invite the agent to file a
 * bug report about someone's expired subscription.
 */
export class FlufUserActionableError extends Error {
  readonly userActionable = true;
}

export class FlufClient {
  constructor(
    private readonly config: FlufClientConfig,
    /** Which MCP tool this instance is serving, sent as X-FLUF-Agent-Tool. */
    private readonly tool?: string
  ) {}

  /** Clone bound to a tool name. Cheap, immutable, safe under concurrent calls. */
  forTool(tool: string): FlufClient {
    return new FlufClient(this.config, tool);
  }

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
        // Lets FLUF's agent-activity panel attribute a call to the tool the agent
        // chose. Purely observational — the server must never trust it for auth.
        ...(this.tool ? { "X-FLUF-Agent-Tool": this.tool } : {}),
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
        throw new FlufUserActionableError(
          `${obj.message || obj.error || "The FLUF API requires an active plan."} ` +
            `Manage your plan: ${obj.billing_url || "https://fluf.io/connect/settings/billing"}`
        );
      }

      if (res.status === 401) {
        throw new FlufUserActionableError(
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
