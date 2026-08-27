"use client";

import { useState, type ReactNode } from "react";
import { DateRangeControl } from "@/components/DateRangeControl";
import { Banner } from "@/components/dashboard-bits";
import { describeRange } from "@/components/Ga4ReportPage";
import { defaultRange, type DateRange } from "@/lib/date-presets";
import type { UmamiSource } from "@/lib/umami";

type FetchState<T> = {
  data: T | null | undefined;
  loading: boolean;
  error: string | null;
  refreshing?: boolean;
};

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-violet-600`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// Shared chrome for the Umami-backed LMS/Lumen report pages: the Ga4ReportPage
// equivalent minus the property picker — one Umami website covers the whole
// LMS (main site + Lumen iframe, separable by hostname inside Umami itself).
//
// The header is a sticky banner: the date range (and any page-supplied
// controls, e.g. the Website page's time-scale picker) stay reachable while
// scrolling a long report.
export function UmamiReportPage<T extends { property: UmamiSource }>({
  title,
  subtitleFallback,
  useData,
  headerControls,
  children,
}: {
  title: string;
  subtitleFallback: string;
  useData: (range: DateRange) => FetchState<T>;
  /** Extra controls rendered in the sticky banner next to the date range. */
  headerControls?: ReactNode;
  children: (data: T, rangeLabel: string) => ReactNode;
}) {
  const [range, setRange] = useState<DateRange>(defaultRange());
  const { data, loading, error, refreshing } = useData(range);
  const busy = loading || !!refreshing;
  // Unlike the GA4 pages (whose backend caps open ranges at 365 days), the
  // Umami routes treat a missing start as genuinely all-time — label honestly.
  const rangeLabel =
    !range.start && !range.end ? "All time" : describeRange(range);

  return (
    <div className="max-w-7xl">
      <div className="sticky top-12 md:top-0 z-40 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 px-8 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-500">{subtitleFallback}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {headerControls}
          <DateRangeControl value={range} onChange={setRange} />
        </div>
      </div>

      <div className="p-8 pt-6">
        {error && <Banner tone="error">{error}</Banner>}

        {!data && busy && (
          <div className="flex flex-col items-center justify-center gap-3 py-32 text-gray-500">
            <Spinner className="w-8 h-8" />
            <p className="text-sm">Loading report…</p>
          </div>
        )}

        {data && (
          <div className="relative">
            {/* Range/refresh changes keep the previous report visible but
                blurred, so the page doesn't collapse while new data loads. */}
            <div
              className={`transition-[filter,opacity] duration-300 ${
                busy ? "blur-sm opacity-60 pointer-events-none select-none" : ""
              }`}
              aria-busy={busy}
            >
              {children(data, rangeLabel)}
            </div>
            {busy && (
              <div className="absolute inset-x-0 top-24 z-10 flex justify-center">
                <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full shadow-md px-4 py-2 text-sm text-gray-700">
                  <Spinner />
                  Updating…
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
