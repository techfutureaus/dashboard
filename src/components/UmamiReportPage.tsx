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
export function UmamiReportPage<T extends { property: UmamiSource }>({
  title,
  subtitleFallback,
  useData,
  children,
}: {
  title: string;
  subtitleFallback: string;
  useData: (range: DateRange) => FetchState<T>;
  children: (data: T, rangeLabel: string) => ReactNode;
}) {
  const [range, setRange] = useState<DateRange>(defaultRange());
  const { data, loading, error } = useData(range);
  // Unlike the GA4 pages (whose backend caps open ranges at 365 days), the
  // Umami routes treat a missing start as genuinely all-time — label honestly.
  const rangeLabel =
    !range.start && !range.end ? "All time" : describeRange(range);

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">
            {data?.property.displayName ?? subtitleFallback}
          </p>
        </div>
        <DateRangeControl value={range} onChange={setRange} />
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <Banner tone="error">{error}</Banner>}
      {data && children(data, rangeLabel)}
    </div>
  );
}
