import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError, type ApiError } from '../services/apiClient';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T | ((previous: T | undefined) => T)) => void;
}

/** Loads data from the API, re-running when dependencies change and ignoring stale responses. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the dependencies the loader closes over
  const stableLoader = useCallback(loader, deps);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await stableLoader();
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) setError(toApiError(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [stableLoader]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData: setData as AsyncState<T>['setData'] };
}
