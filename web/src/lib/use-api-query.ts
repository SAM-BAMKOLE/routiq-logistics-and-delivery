"use client";

import * as React from "react";
import { ApiError, type ApiClient } from "./api";
import { useSession } from "./session";

export interface ApiQueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetches data from the API on mount and when `deps` change. The fetch callback
 * is held in a ref so callers can inline arrow functions without causing loops.
 */
export function useApiQuery<T>(
  fetcher: (api: ApiClient) => Promise<T>,
  deps: React.DependencyList = [],
): ApiQueryResult<T> {
  const { api, session } = useSession();
  const fetcherRef = React.useRef(fetcher);

  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  // Keep the latest fetcher without making it a dependency; runs before the
  // fetch effect below because effects fire in declaration order.
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  });

  React.useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetcherRef
      .current(api)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : "Something went wrong",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, session, nonce, ...deps]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}
