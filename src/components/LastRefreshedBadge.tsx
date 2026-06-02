"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  fetchedAt: Date | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function LastRefreshedBadge({ fetchedAt, refreshing, onRefresh }: Props) {
  // Force re-render every minute so the relative time stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const label = fetchedAt
    ? `Updated ${formatDistanceToNow(fetchedAt, { addSuffix: true })}`
    : "—";

  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      {refreshing ? (
        <Spinner />
      ) : (
        <span
          className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"
          aria-hidden
        />
      )}
      <span>{refreshing ? "Refreshing…" : label}</span>
      {onRefresh && !refreshing && (
        <button
          onClick={onRefresh}
          className="ml-1 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
          aria-label="Refresh now"
          title="Refresh now"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="w-3 h-3 animate-spin text-violet-600"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
