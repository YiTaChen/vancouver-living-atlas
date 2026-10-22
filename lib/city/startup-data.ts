/** Optional startup diagnostics. Normal loads retain Response.json().
 * Header wait and body read/decode are asynchronous elapsed wall time; JSON
 * parsing is synchronous elapsed wall time. None of these measures GPU time.
 */
export interface StartupDataProbe {
  begin(name: string, kind: 'sync-main-thread-wall' | 'async-wall'): void;
  end(name: string): void;
  mark(name: string, detail?: Record<string, unknown>): void;
}

export interface StartupJsonOptions {
  signal?: AbortSignal;
  /** Optional data may return undefined on a non-success HTTP response. */
  required?: boolean;
  label?: string;
  errorMessage?: (status: number) => string;
}

interface StartupDataOptions {
  probe?: StartupDataProbe | null;
  fetch?: typeof fetch;
  now?: () => number;
  /** Bound diagnostic overhead even if this loader is reused after startup. */
  maxInstrumentedRequests?: number;
}

export function createStartupDataLoader(options: StartupDataOptions = {}) {
  const fetchData = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  const requestedLimit = options.maxInstrumentedRequests ?? 32;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(128, Math.max(0, Math.floor(requestedLimit)))
    : 32;
  let instrumented = 0;

  async function json<T>(
    url: string,
    request: StartupJsonOptions & { required: false },
  ): Promise<T | undefined>;
  async function json<T>(
    url: string,
    request?: StartupJsonOptions & { required?: true },
  ): Promise<T>;
  async function json<T>(
    url: string,
    request: StartupJsonOptions,
  ): Promise<T | undefined>;
  async function json<T>(
    url: string,
    request: StartupJsonOptions = {},
  ): Promise<T | undefined> {
    const probe = options.probe && instrumented < limit ? options.probe : null;
    if (!probe) {
      const response = await fetchData(url, { signal: request.signal });
      if (!response.ok) {
        if (request.required === false) return undefined;
        throw new Error(
          request.errorMessage?.(response.status) ??
            `Could not load ${url} (${response.status})`,
        );
      }
      return (await response.json()) as T;
    }
    const id = ++instrumented;
    // The sequence also allows concurrent requests with the same label.
    const prefix = `data.${request.label ?? url}.${id}`;
    let phase = 'headers';
    let activeSpan: string | null = null;
    let status: number | null = null;
    const elapsed: Record<string, number> = {};
    let startedAt = 0;
    const begin = (name: string, sync = false) => {
      phase = name;
      activeSpan = `${prefix}.${name}`;
      probe.begin(activeSpan, sync ? 'sync-main-thread-wall' : 'async-wall');
      startedAt = now();
    };
    const end = () => {
      if (!activeSpan) return;
      elapsed[phase] = now() - startedAt;
      probe.end(activeSpan);
      activeSpan = null;
    };
    try {
      begin('headers');
      const response = await fetchData(url, { signal: request.signal });
      status = response.status;
      end();
      if (!response.ok) {
        probe.mark(`${prefix}.http-error`, { url, status, ...elapsed });
        if (request.required === false) return undefined;
        throw new Error(
          request.errorMessage?.(status) ?? `Could not load ${url} (${status})`,
        );
      }
      begin('body-read');
      const text = await response.text();
      end();
      begin('json-parse', true);
      const value = JSON.parse(text) as T;
      end();
      probe.mark(`${prefix}.complete`, {
        url,
        status,
        ...elapsed,
        // UTF-16 code units, deliberately not called bytes/download size.
        // Actual encoded/decoded/transfer bytes belong to Resource Timing.
        textCodeUnits: text.length,
      });
      return value;
    } catch (error) {
      end();
      probe.mark(`${prefix}.failed`, { url, status, phase, ...elapsed });
      throw error;
    }
  }

  return { json };
}
