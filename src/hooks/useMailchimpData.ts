"use client";

import { useEffect, useState } from "react";
import type {
  Audience,
  AudienceSummary,
  GrowthHistoryItem,
  SegmentItem,
  CampaignReport,
} from "@/lib/mailchimp";

export interface MailchimpDashboardData {
  audience: Audience;
  growth: GrowthHistoryItem[];
  segments: SegmentItem[];
  reports: CampaignReport[];
}

export function useMailchimpData(listId: string = "") {
  const [data, setData] = useState<MailchimpDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const url = listId
    ? `/api/mailchimp/dashboard?listId=${encodeURIComponent(listId)}`
    : "/api/mailchimp/dashboard";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body as MailchimpDashboardData;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading, error };
}

export function useMailchimpAudiences() {
  const [audiences, setAudiences] = useState<AudienceSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mailchimp/audiences")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body.audiences as AudienceSummary[];
      })
      .then((d) => !cancelled && setAudiences(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { audiences, loading, error };
}
