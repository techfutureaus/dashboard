"use client";

import { format } from "date-fns";
import { useFreshFetch } from "./useFreshFetch";
import { TAGS } from "@/lib/cache-tags";
import type { Ga4DashboardData, Property } from "@/lib/ga4";
import type { DateRange } from "@/lib/date-presets";

export function useGa4Properties() {
  const res = useFreshFetch<{ properties: Property[] }>(
    "/api/ga4/properties",
    TAGS.ga4Properties
  );
  return {
    ...res,
    properties: res.data?.properties ?? null,
  };
}

export function useGa4Dashboard(propertyId: string | null, range: DateRange) {
  let url: string | null = null;
  if (propertyId) {
    const params = new URLSearchParams({ propertyId });
    if (range.start) params.set("start", format(range.start, "yyyy-MM-dd"));
    if (range.end) params.set("end", format(range.end, "yyyy-MM-dd"));
    url = `/api/ga4/dashboard?${params.toString()}`;
  }
  return useFreshFetch<Ga4DashboardData>(url, TAGS.ga4Dashboard);
}
