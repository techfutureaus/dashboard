"use client";

import { useEffect, useState } from "react";
import type { Ga4DashboardData, Property } from "@/lib/ga4";
import type { DateRange } from "@/lib/date-presets";
import { format } from "date-fns";

export function useGa4Properties() {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ga4/properties")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body.properties as Property[];
      })
      .then(setProperties)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { properties, loading, error };
}

export function useGa4Dashboard(propertyId: string | null, range: DateRange) {
  const [data, setData] = useState<Ga4DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(!!propertyId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ propertyId });
    if (range.start) params.set("start", format(range.start, "yyyy-MM-dd"));
    if (range.end) params.set("end", format(range.end, "yyyy-MM-dd"));

    let cancelled = false;
    fetch(`/api/ga4/dashboard?${params.toString()}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body as Ga4DashboardData;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [propertyId, range.start, range.end]);

  return { data, loading, error };
}
