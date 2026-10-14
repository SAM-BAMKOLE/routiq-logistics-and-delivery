import type { Logger } from './logger.js';
import type { AuthResponse } from './types.js';

/**
 * RFC 9457 `application/problem+json` body the API returns for every error.
 * The bots surface `code` so failures read like the API's own vocabulary.
 */
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
    const code = problem?.code ? ` ${problem.code}` : '';
    const detail = problem?.detail ?? problem?.title ?? '';
    super(`${method} ${path} → ${status}${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  ifMatch?: string | number;
  auth?: boolean;
}

/**
 * A small, dependency-free client for the Routiq API. It owns one identity's
 * token pair, transparently refreshes the access token once on 401, and turns
 * every failure into an {@link ApiError} carrying the problem document.
 */
export class RoutiqClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly log?: Logger,
  ) {}

  get hasSession(): boolean {
    return this.accessToken !== null;
  }

  async login(email: string, password: string, tenantId?: string): Promise<AuthResponse> {
    const auth = await this.request<AuthResponse>('POST', '/auth/login', {
      body: { email, password, ...(tenantId ? { tenantId } : {}) },
      auth: false,
    });
    this.accessToken = auth.accessToken;
    this.refreshToken = auth.refreshToken;
    return auth;
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions,
    allowRefresh = true,
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = { accept: 'application/json' };

    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.ifMatch !== undefined) headers['if-match'] = String(options.ifMatch);
    if (options.auth !== false && this.accessToken) {
      headers.authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 401 && allowRefresh && options.auth !== false && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.request<T>(method, path, options, false);
    }

    const raw = await response.text();
    const parsed = raw.length > 0 ? safeJson(raw) : null;

    if (!response.ok) {
      throw new ApiError(response.status, (parsed as ProblemDetails | null) ?? null, method, path);
    }
    return parsed as T;
  }

  /** Rotates the refresh token and swaps in a new access token. */
  private async tryRefresh(): Promise<boolean> {
    const token = this.refreshToken;
    if (!token) return false;
    try {
      const auth = await this.request<AuthResponse>(
        'POST',
        '/auth/refresh',
        { body: { refreshToken: token }, auth: false },
        false,
      );
      this.accessToken = auth.accessToken;
      this.refreshToken = auth.refreshToken;
      this.log?.info('refreshed access token');
      return true;
    } catch {
      return false;
    }
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

/** Parses JSON without throwing; the body is already known to be non-empty. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
