"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

interface RefreshContextValue {
  /** Increments every time a global refresh is triggered. Hooks watch this to re-fetch. */
  refreshKey: number;
  /** True while a global refresh is in-flight. */
  refreshing: boolean;
  /** Trigger a global refresh: busts all cache tags + bumps refreshKey so hooks re-fetch. */
  triggerRefresh: () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextValue | undefined>(undefined);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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

  return (
    <RefreshContext.Provider value={{ refreshKey, refreshing, triggerRefresh }}>
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
