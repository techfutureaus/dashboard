"use client";

import { useEffect, useState } from "react";

interface CountItem {
  name: string;
  count: number;
  [k: string]: string | number;
}

export type Row = Record<string, unknown>;

export interface PeopleRecords {
  volunteers: Row[];
  teachers: Row[];
  cadetship: Row[];
}

export interface ImpactAgg {
  csisSeries: { term: string; studentsCoding: number; avgTimeCoding: number }[];
  completingSeries: { year: string; students: number }[];
  industryPartnersTotal: number;
}

export interface UpliftPair {
  before: number | null;
  after: number | null;
  uplift: number | null;
  n: number;
}

export interface TeacherTrainingAgg {
  total: number;
  facets: { events: string[] };
  byEvent: CountItem[];
  byFormat: CountItem[];
  avgSatisfaction: number | null;
  satN: number;
  avgRecommend: number | null;
  recommendN: number;
  confidenceUplift: { primary: UpliftPair; secondary: UpliftPair };
  competenceCodingUplift: { primary: UpliftPair; secondary: UpliftPair };
  competenceThinkingUplift: { primary: UpliftPair; secondary: UpliftPair };
}

export interface CareersDaysAgg {
  total: number;
  facets: { events: string[] };
  byEvent: CountItem[];
  understandingUplift: UpliftPair;
  confidenceCareersUplift: UpliftPair;
  confidenceImpactUplift: UpliftPair;
  confidenceAIUplift: UpliftPair;
  studentPerceptions: CountItem[];
  whyAttending: CountItem[];
  wantedSupport: CountItem[];
}

function makeStaticHook<T>(url: string) {
  return function () {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      fetch(url)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
          return body as T;
        })
        .then((d) => !cancelled && setData(d))
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
      return () => {
        cancelled = true;
      };
    }, []);

    return { data, loading, error };
  };
}

function makeParamHook<T, P extends Record<string, string | undefined>>(baseUrl: string) {
  return function (params: P) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v);
    }
    const key = qs.toString();
    const url = key ? `${baseUrl}?${key}` : baseUrl;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      fetch(url)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
          return body as T;
        })
        .then((d) => !cancelled && setData(d))
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
      return () => {
        cancelled = true;
      };
    }, [url]);

    return { data, loading, error };
  };
}

// Schools + People return raw record sets — client aggregates with current filters.
export function useSchoolsRecords() {
  return makeStaticHook<{ records: Row[] }>("/api/airtable/schools")();
}

export const usePeopleRecords = makeStaticHook<PeopleRecords>("/api/airtable/people");

export const useImpactAgg = makeStaticHook<ImpactAgg>("/api/airtable/impact");

// Training + Careers Days: server filters via query params, client just renders.
export const useTeacherTrainingAgg = makeParamHook<
  TeacherTrainingAgg,
  { event?: string; cohort?: string }
>("/api/airtable/teacher-training");

export const useCareersDaysAgg = makeParamHook<CareersDaysAgg, { event?: string }>(
  "/api/airtable/careers-days"
);
