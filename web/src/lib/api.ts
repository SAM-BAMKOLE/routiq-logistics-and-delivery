import type { AuthResponse } from "./types";

/** Base URL of the Routiq API, including the `/api/v1` prefix. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3000/api/v1";

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
    readonly method: string,
    readonly path: string,
  ) {
    super(
      problem?.detail ??
        problem?.title ??
        `${method} ${path} failed with status ${status}`,
    );
    this.name = "ApiError";
  }

  get code(): string | null {
    return this.problem?.code ?? null;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Human-readable message for anything thrown by the client. API failures carry
 * the RFC 9457 `detail` plus a machine code we surface in parentheses, which is
 * what the auth screens show to the user.
 */
export function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.code ? `${cause.message} (${cause.code})` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Something went wrong. Please try again.";
}

interface SendOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  ifMatch?: string | number;
  /** Pass `null` to send an unauthenticated request. */
  token?: string | null;
}

/**
 * Browser-side client for the Routiq API. It reads the current token pair from
 * the session provider, attaches it, and retries once after a token refresh on
 * 401. Errors surface as {@link ApiError} carrying the RFC 9457 problem
 * document.
 */
export class ApiClient {
  constructor(
    private readonly getTokens: () => TokenPair | null,
    private readonly setTokens: (tokens: TokenPair | null) => void,
  ) {}

  async login(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<AuthResponse> {
    const auth = await this.send<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password, ...(tenantId ? { tenantId } : {}) },
      token: null,
    });
    this.setTokens({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    return auth;
  }

  async register(input: {
    companyName: string;
    name?: string;
    email: string;
    password: string;
  }): Promise<AuthResponse> {
    const auth = await this.send<AuthResponse>("/auth/register", {
      method: "POST",
      body: input,
      token: null,
    });
    this.setTokens({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    return auth;
  }

  async acceptInvite(token: string, password: string): Promise<AuthResponse> {
    const auth = await this.send<AuthResponse>("/auth/accept-invite", {
      method: "POST",
      body: { token, password },
      token: null,
    });
    this.setTokens({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    return auth;
  }

  async forgotPassword(email: string): Promise<void> {
    await this.send("/auth/forgot-password", {
      method: "POST",
      body: { email },
      token: null,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.send("/auth/reset-password", {
      method: "POST",
      body: { token, password },
      token: null,
    });
  }

  async switchTenant(tenantId: string): Promise<AuthResponse> {
    const tokens = this.getTokens();
    if (!tokens) throw new Error("Not signed in.");
    const auth = await this.send<AuthResponse>("/auth/switch-tenant", {
      method: "POST",
      body: { refreshToken: tokens.refreshToken, tenantId },
      token: null,
    });
    this.setTokens({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    return auth;
  }

  async logout(): Promise<void> {
    const tokens = this.getTokens();
    this.setTokens(null);
    if (!tokens) return;
    try {
      await this.send("/auth/logout", {
        method: "POST",
        body: { refreshToken: tokens.refreshToken },
        token: null,
      });
    } catch {
      // Logout is best-effort: the local session is already cleared.
    }
  }

  get<T>(path: string, query?: SendOptions["query"]): Promise<T> {
    return this.send<T>(path, { method: "GET", query });
  }

  post<T>(path: string, body?: unknown, options: Pick<SendOptions, "ifMatch"> = {}): Promise<T> {
    return this.send<T>(path, { method: "POST", body, ...options });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>(path, { method: "PATCH", body });
  }

  private async send<T>(
    path: string,
    options: SendOptions,
    allowRefresh = true,
  ): Promise<T> {
    const tokens = this.getTokens();
    const token =
      options.token !== undefined ? options.token : (tokens?.accessToken ?? null);

    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.ifMatch !== undefined) headers["if-match"] = String(options.ifMatch);
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetch(this.buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 401 && allowRefresh && token) {
      const refreshed = await this.refresh();
      if (refreshed) return this.send<T>(path, options, false);
    }

    const raw = await response.text();
    const parsed = raw.length > 0 ? safeJson(raw) : null;

    if (!response.ok) {
      throw new ApiError(
        response.status,
        (parsed as ProblemDetails | null) ?? null,
        options.method ?? "GET",
        path,
      );
    }
    return parsed as T;
  }

  private async refresh(): Promise<boolean> {
    const tokens = this.getTokens();
    if (!tokens) return false;
    try {
      const auth = await this.send<AuthResponse>(
        "/auth/refresh",
        { method: "POST", body: { refreshToken: tokens.refreshToken }, token: null },
        false,
      );
      this.setTokens({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      });
      return true;
    } catch {
      this.setTokens(null);
      return false;
    }
  }

  private buildUrl(
    path: string,
    query?: SendOptions["query"],
  ): string {
    const url = new URL(`${API_BASE_URL}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
