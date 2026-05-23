"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
  lastUpdated: Date | null;
  refetch: () => void;
}

export function useFetch<T>(url: string | null): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }

    // Abort any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(false);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(new Date());
      } else {
        setError(true);
      }
    } catch (e) {
      // Don't set error state for aborted requests
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchData]);

  return { data, loading, error, lastUpdated, refetch: fetchData };
}
