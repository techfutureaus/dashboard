"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRefresh } from "@/contexts/RefreshContext";

const REFRESH_THRESHOLD_MS = 25 * 60 * 60 * 1000; // 25 hours

export interface FreshFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  fetchedAt: Date | null;
  refreshing: boolean;
  /** Bust the cache for this source then re-fetch. */
  refresh: () => Promise<void>;
}

/**
 * Generic fetch hook used by every dashboard hook:
 * - Captures `X-Fetched-At` from the response
 * - One-shot setTimeout: when fetchedAt + 25h hits, auto-refresh
 * - Subscribes to global RefreshContext (sidebar button bumps refreshKey)
 * - Exposes a local `refresh()` for per-source manual refresh
 */
export function useFreshFetch<T>(url: string | null, source: string): FreshFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { refreshKey, reportFetchedAt } = useRefresh();
  const cancelRef = useRef(false);

  const load = useCallback(
    async (bustCache: boolean) => {
      if (!url) return;
      cancelRef.current = false;

      if (bustCache) {
        setRefreshing(true);
        try {
          await fetch(`/api/refresh?source=${encodeURIComponent(source)}`, { method: "POST" });
        } catch (err) {
          console.error("Cache bust failed:", err);
        }
      } else {
        setLoading(true);
      }

      try {
        const res = await fetch(url);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelRef.current) return;
        setData(body as T);
        const tsHeader = res.headers.get("X-Fetched-At");
        const ts = tsHeader ? new Date(tsHeader) : new Date();
        setFetchedAt(ts);
        reportFetchedAt(ts);
        setError(null);
      } catch (err) {
        if (cancelRef.current) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [url, source, reportFetchedAt]
  );

  // Initial load + reload on URL change OR global refresh event
  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    load(false);
    return () => {
      cancelRef.current = true;
    };
  }, [url, refreshKey, load]);

  // One-shot 25h auto-refresh timer
  useEffect(() => {
    if (!fetchedAt) return;
    const target = fetchedAt.getTime() + REFRESH_THRESHOLD_MS;
    const delay = Math.max(0, target - Date.now());
    const id = setTimeout(() => {
      load(true);
    }, delay);
    return () => clearTimeout(id);
  }, [fetchedAt, load]);

  const refresh = useCallback(() => load(true), [load]);

  return { data, loading, error, fetchedAt, refreshing, refresh };
}
