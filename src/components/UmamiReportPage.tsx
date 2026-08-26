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
};

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
  const { data, loading, error } = useData(range);
  // Unlike the GA4 pages (whose backend caps open ranges at 365 days), the
  // Umami routes treat a missing start as genuinely all-time — label honestly.
  const rangeLabel =
    !range.start && !range.end ? "All time" : describeRange(range);

  return (
    <div className="max-w-7xl">
      <div className="sticky top-0 z-40 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 px-8 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-500">
            {data?.property.displayName ?? subtitleFallback}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {headerControls}
          <DateRangeControl value={range} onChange={setRange} />
        </div>
      </div>

      <div className="p-8 pt-6">
        {loading && <div className="text-gray-500">Loading…</div>}
        {error && <Banner tone="error">{error}</Banner>}
        {data && children(data, rangeLabel)}
      </div>
    </div>
  );
}
