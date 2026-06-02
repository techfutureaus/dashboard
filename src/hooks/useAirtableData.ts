"use client";

import { useFreshFetch } from "./useFreshFetch";
import { TAGS } from "@/lib/cache-tags";

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

function buildUrl(baseUrl: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${baseUrl}?${s}` : baseUrl;
}

export function useSchoolsRecords() {
  return useFreshFetch<{ records: Row[] }>("/api/airtable/schools", TAGS.airtableSchools);
}

export function usePeopleRecords() {
  return useFreshFetch<PeopleRecords>("/api/airtable/people", TAGS.airtablePeople);
}

export function useImpactAgg() {
  return useFreshFetch<ImpactAgg>("/api/airtable/impact", TAGS.airtableImpact);
}

export function useTeacherTrainingAgg(params: { event?: string; cohort?: string }) {
  const url = buildUrl("/api/airtable/teacher-training", params);
  return useFreshFetch<TeacherTrainingAgg>(url, TAGS.airtableTeacherTraining);
}

export function useCareersDaysAgg(params: { event?: string }) {
  const url = buildUrl("/api/airtable/careers-days", params);
  return useFreshFetch<CareersDaysAgg>(url, TAGS.airtableCareersDays);
}
