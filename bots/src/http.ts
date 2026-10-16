import { sleep, type Logger } from './logger.js';
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
 * Statuses worth retrying: a host that is spinning up (502/503/504), a gateway
 * timeout, or throttling. A 4xx is the API answering — retrying it would just
 * repeat the mistake.
 */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Total attempts per request, including the first. Overridable for tests. */
const MAX_ATTEMPTS = Math.max(1, Number(process.env.ROUTIQ_BOT_HTTP_RETRIES ?? 6));

/** Per-attempt ceiling, so one hung request cannot wedge a whole run. */
const REQUEST_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.ROUTIQ_BOT_HTTP_TIMEOUT_MS ?? 30_000),
);

const MAX_BACKOFF_MS = 15_000;

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

    // A free-tier host spins down when idle: the first request after a while is
    // expected to fail while it boots, and a later attempt succeeds. Retry
    // transient failures with backoff instead of aborting the run.
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS) {
          await this.backoff(method, path, attempt, describe(error));
          continue;
        }
        throw error;
      }

      if (response.status === 401 && allowRefresh && options.auth !== false && this.refreshToken) {
        const refreshed = await this.tryRefresh();
        if (refreshed) return this.request<T>(method, path, options, false);
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        await this.backoff(
          method,
          path,
          attempt,
          `HTTP ${response.status}`,
          retryAfterMs(response.headers.get('retry-after')),
        );
        continue;
      }

      const raw = await response.text();
      const parsed = raw.length > 0 ? safeJson(raw) : null;

      if (!response.ok) {
        throw new ApiError(response.status, (parsed as ProblemDetails | null) ?? null, method, path);
      }
      return parsed as T;
    }
  }

  /** Exponential backoff, capped, honouring `Retry-After` when the server sent one. */
  private async backoff(
    method: string,
    path: string,
    attempt: number,
    reason: string,
    retryAfter?: number,
  ): Promise<void> {
    const delay = Math.min(retryAfter ?? 2 ** (attempt - 1) * 1_000, MAX_BACKOFF_MS);
    this.log?.warn(
      `${method} ${path} failed (${reason}); retrying in ${Math.round(delay / 1_000)}s`,
      `attempt ${attempt}/${MAX_ATTEMPTS}`,
    );
    await sleep(delay);
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

/** Reads `Retry-After` as either delta-seconds or an HTTP date. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
