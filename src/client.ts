const DEFAULT_BASE_URL = "https://fluf.io";

export interface FlufClientConfig {
  baseUrl: string;
  token: string;
}

export function loadConfig(): FlufClientConfig {
  const token = process.env.FLUF_API_TOKEN;
  if (!token) {
    throw new Error(
      "FLUF_API_TOKEN environment variable is required. " +
        "Generate one at https://fluf.io/connect/settings/tokens " +
        "(token format: fluf_pat_...). " +
        "POST /wp-json/fc/v1/tokens with a JWT also works for CI."
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
        "User-Agent": "fluf-mcp/0.1.0",
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
            "issue a new one at https://fluf.io/connect/settings/tokens"
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
