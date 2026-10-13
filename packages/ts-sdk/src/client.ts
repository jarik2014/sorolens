import { operations, type Operation, type OperationId } from "./generated/operations";

export * from "./generated/operations";
export * from "./generated/types";

export interface ClientOptions {
  /** API key sent as `Authorization: Bearer …`. Omit for the public endpoints. */
  apiKey?: string;
  /** Defaults to `http://localhost:8080`. */
  baseUrl?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra attempts after a retryable failure (429 or 5xx). Default 2. */
  retries?: number;
  /** Base delay for the exponential backoff, in milliseconds. Default 250. */
  retryDelayMs?: number;
  /** Called before each retry attempt, useful for logging in tests. */
  onRetry?: (attempt: number, response: Response | undefined, error: unknown) => void;
}

export interface RequestOptions {
  /** Values for the operation's `path` parameters. */
  pathParams?: Record<string, string | number>;
  /** Values for the operation's `query` parameters. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Serialised as the JSON request body. */
  body?: unknown;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
  /** Overrides the client-level retry budget for this call. */
  retries?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string;
}

/** An HTTP error response from the API, with the parsed body. */
export class SorolensError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly operationId: string;

  constructor(operationId: string, status: number, body: unknown, message?: string) {
    super(message ?? `Sorolens ${operationId} failed with HTTP ${status}`);
    this.name = "SorolensError";
    this.status = status;
    this.body = body;
    this.operationId = operationId;
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A thin, dependency-free client over the generated operation table.
 *
 * It builds URLs from the spec (path parameters are substituted, query values
 * are URL-encoded and `undefined`/empty entries are dropped), adds the API key,
 * retries retryable failures with exponential backoff, and exposes
 * {@link SorolensClient.paginate} for the cursor-based list endpoints.
 */
export class SorolensClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly onRetry?: ClientOptions["onRetry"];

  constructor(options: ClientOptions = {}) {
    const globalFetch = typeof fetch === "function" ? fetch : undefined;
    const fetchImpl = options.fetch ?? globalFetch;
    if (!fetchImpl) {
      throw new Error("No fetch implementation available; pass `fetch` in ClientOptions");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "http://localhost:8080").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.onRetry = options.onRetry;
  }

  /** The operation table entry, or a clear error when the id is unknown. */
  operation(operationId: OperationId): Operation {
    const operation = operations[operationId] as Operation | undefined;
    if (!operation) {
      throw new Error(`Unknown operation "${operationId}"`);
    }
    return operation;
  }

  /** Absolute URL for an operation, with path and query parameters applied. */
  url(operationId: OperationId, options: RequestOptions = {}): string {
    const operation = this.operation(operationId);
    const path = operation.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = options.pathParams?.[name];
      if (value === undefined || value === null || value === "") {
        throw new Error(`Missing path parameter "${name}" for ${operationId}`);
      }
      return encodeURIComponent(String(value));
    });

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      query.set(key, String(value));
    }
    const search = query.toString();

    return `${this.baseUrl}${path}${search ? `?${search}` : ""}`;
  }

  /** Performs the request and returns the parsed JSON body. */
  async request<T = unknown>(operationId: OperationId, options: RequestOptions = {}): Promise<T> {
    const operation = this.operation(operationId);
    const url = this.url(operationId, options);
    const retries = options.retries ?? this.retries;

    let attempt = 0;
    for (;;) {
      let response: Response | undefined;
      let failure: unknown;
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
        const init: RequestInit = { method: operation.method, headers };
        if (options.body !== undefined) {
          headers["content-type"] = "application/json";
          init.body = JSON.stringify(options.body);
        }
        if (options.signal) init.signal = options.signal;

        response = await this.fetchImpl(url, init);
      } catch (error) {
        failure = error;
      }

      if (response && response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const retryable = failure !== undefined || (response ? isRetryable(response.status) : false);
      if (retryable && attempt < retries) {
        attempt += 1;
        this.onRetry?.(attempt, response, failure);
        await sleep(this.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      if (failure !== undefined) throw failure;
      const status = response?.status ?? 0;
      const body = await response!.text();
      let parsed: unknown = body;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        // keep the raw text
      }
      throw new SorolensError(operationId, status, parsed);
    }
  }

  /** True when the operation is a cursor-paginated list endpoint. */
  supportsPagination(operationId: OperationId): boolean {
    return this.operation(operationId).parameters.some(
      (parameter) => parameter.name === "cursor" && parameter.in === "query"
    );
  }

  /**
   * Walks a cursor-paginated endpoint. Yields one page at a time and stops when
   * the API returns an empty `next_cursor` or `maxPages` is reached.
   */
  async *paginate<T = unknown>(
    operationId: OperationId,
    options: RequestOptions & { maxPages?: number } = {}
  ): AsyncGenerator<T[], void, undefined> {
    if (!this.supportsPagination(operationId)) {
      throw new Error(`${operationId} is not cursor-paginated`);
    }
    const { maxPages = Number.POSITIVE_INFINITY, ...requestOptions } = options;

    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.request<Record<string, unknown> & { next_cursor?: string }>(
        operationId,
        { ...requestOptions, query: { ...requestOptions.query, cursor } }
      );
      const items = Object.values(response).find(Array.isArray) as T[] | undefined;
      yield items ?? [];

      cursor = response.next_cursor || undefined;
      if (!cursor) return;
    }
  }
}
