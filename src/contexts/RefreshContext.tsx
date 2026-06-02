"use client";

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";

interface RefreshContextValue {
  /** Increments every time a global refresh is triggered. Hooks watch this to re-fetch. */
  refreshKey: number;
  /** True while a global refresh is in-flight. */
  refreshing: boolean;
  /** Trigger a global refresh: busts all cache tags + bumps refreshKey so hooks re-fetch. */
  triggerRefresh: () => Promise<void>;
  /** Most recent fetch time across all hooks, surfaced in the sidebar badge. */
  latestFetchedAt: Date | null;
  /** Called by useFreshFetch whenever a fetch successfully resolves. */
  reportFetchedAt: (date: Date) => void;
}

const RefreshContext = createContext<RefreshContextValue | undefined>(undefined);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [latestFetchedAt, setLatestFetchedAt] = useState<Date | null>(null);
  // Use a ref to avoid causing re-renders when comparing timestamps.
  const latestRef = useRef<Date | null>(null);

  const triggerRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/refresh?source=all", { method: "POST" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error("Refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const reportFetchedAt = useCallback((date: Date) => {
    if (!latestRef.current || date.getTime() > latestRef.current.getTime()) {
      latestRef.current = date;
      setLatestFetchedAt(date);
    }
  }, []);

  return (
    <RefreshContext.Provider
      value={{ refreshKey, refreshing, triggerRefresh, latestFetchedAt, reportFetchedAt }}
    >
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  const ctx = useContext(RefreshContext);
  if (!ctx) {
    throw new Error("useRefresh must be used inside RefreshProvider");
  }
  return ctx;
}
