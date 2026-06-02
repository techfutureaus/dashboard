import Airtable from "airtable";
import Bottleneck from "bottleneck";

Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });

export const base = Airtable.base(process.env.AIRTABLE_BASE_ID!);

// 5 req/sec per base — Airtable's published rate limit.
// maxConcurrent: 5 + minTime: 200ms means we can fire 5 requests in parallel,
// then each subsequent request waits 200ms after the previous one started.
// Net throughput stays at 5/sec but parallel tables (e.g. People tab fetches
// volunteers + teachers + cadetship at once) no longer queue serially.
export const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

// ── Table IDs (stable — names can change, IDs can't) ────────────────
const TABLES = {
  contacts: "tblSoRqyfHpc7tCbs",
  schools: "tbl4MiexjkFyn63HI",
  teachers: "tbl2bp4AEvywJ078M",
  volunteers: "tblrwBMA45TjOjw6O",
  cadetship: "tblZLzwgzXeqdIC3a",
  csinschools: "tblz94hHcvh6MQRyd",
  studentsCompleting: "tblhKLNE7zFt3gcfd",
  industryPartners: "tblyPRE4OeRqitpMR",
} as const;

// ── Fetcher (always specify fields[] to keep payloads small) ────────
async function fetchTable<T extends Airtable.FieldSet>(
  tableId: string,
  fields: string[],
  filterByFormula?: string
): Promise<Airtable.Record<T>[]> {
  const options: Airtable.SelectOptions<Airtable.FieldSet> = { fields };
  if (filterByFormula) options.filterByFormula = filterByFormula;
  const records = await limiter.schedule(() => base(tableId).select(options).all());
  return records as unknown as Airtable.Record<T>[];
}

import { countBy, countByMulti, type CountItem } from "./aggregation";
export { countBy, countByMulti, type CountItem } from "./aggregation";

/** Convert Airtable records to plain serializable rows containing only the requested fields. */
function toRows<T extends Airtable.FieldSet>(
  records: Airtable.Record<T>[],
  fields: string[]
): Record<string, unknown>[] {
  return records.map((r) => {
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const v = r.get(f);
      if (v !== undefined) row[f] = v;
    }
    return row;
  });
}

// ── Schools (Schools & reach tab) ───────────────────────────────────

export const ICSEA_ORDER = [
  "<701",
  "701-800",
  "801-900",
  "901-950",
  "951-1,000",
  "1,001-1,050",
  "1,051-1,100",
  "1,101-1,150",
  "1,151-1,200",
];

const SCHOOL_FIELDS = [
  "State",
  "Activation Status",
  "Programme Implemented",
  "Sector",
  "School Type",
  "Location",
  "ICSEA tag",
];

export async function getSchoolsRecords() {
  const records = await fetchTable(TABLES.schools, SCHOOL_FIELDS);
  return toRows(records, SCHOOL_FIELDS);
}

// ── People (Volunteers, Cadetship, Teachers) ────────────────────────

const VOLUNTEER_FIELDS = [
  "Application Status",
  "Volunteer activation",
  "Location",
  "State",
  "Years Participated",
];
const TEACHER_FIELDS = ["State", "Years Participated"];
const CADETSHIP_FIELDS = ["tag", "Created"];

export async function getPeopleRecords() {
  const [volunteers, cadetship, teachers] = await Promise.all([
    fetchTable(TABLES.volunteers, VOLUNTEER_FIELDS),
    fetchTable(TABLES.cadetship, CADETSHIP_FIELDS),
    fetchTable(TABLES.teachers, TEACHER_FIELDS),
  ]);

  return {
    volunteers: toRows(volunteers, VOLUNTEER_FIELDS),
    teachers: toRows(teachers, TEACHER_FIELDS),
    cadetship: toRows(cadetship, CADETSHIP_FIELDS),
  };
}

// ── Impact (csinschools, students completing, partners) ─────────────

export async function getImpactAgg() {
  const [csis, completing, partners] = await Promise.all([
    fetchTable(TABLES.csinschools, [
      "Term",
      "avg time spent coding",
      "# students coding",
      "Include in dashboard",
    ]),
    fetchTable(TABLES.studentsCompleting, ["Year", "Students", "Cost per student"]),
    fetchTable(TABLES.industryPartners, ["Name"]),
  ]);

  // csinschools.io: only rows flagged Include in dashboard
  const csisSeries = csis
    .filter((r) => Boolean(r.get("Include in dashboard")))
    .map((r) => ({
      term: String(r.get("Term") ?? ""),
      studentsCoding: Number(r.get("# students coding") ?? 0),
      avgTimeCoding: Number(r.get("avg time spent coding") ?? 0),
    }))
    .filter((r) => r.term)
    .sort((a, b) => termSortKey(a.term).localeCompare(termSortKey(b.term)));

  // Students completing course (one row per year)
  const completingSeries = completing
    .map((r) => {
      const year = String(r.get("Year") ?? "");
      const studentsRaw = r.get("Students");
      const students = typeof studentsRaw === "number" ? studentsRaw : Number(String(studentsRaw ?? "").replace(/[^0-9.]/g, ""));
      return { year, students: Number.isFinite(students) ? students : 0 };
    })
    .filter((r) => r.year)
    .sort((a, b) => a.year.localeCompare(b.year));

  return {
    csisSeries,
    completingSeries,
    industryPartnersTotal: partners.length,
  };
}

/** Term strings like "2024 Term 1" → "2024-1" for sortability. */
function termSortKey(term: string): string {
  const m = term.match(/(\d{4}).*?(\d)/);
  return m ? `${m[1]}-${m[2]}` : term;
}

// ── Teacher Training tab ────────────────────────────────────────────
// Maps 5-point Likert singleSelects to 1-5 numeric scores.

const CONFIDENCE_MAP: Record<string, number> = {
  "Not at all confident": 1,
  "Slightly confident": 2,
  "Moderately confident": 3,
  "Very confident": 4,
  "Extremely confident": 5,
  "No confidence": 1,
  "Expert level": 5,
};

const COMPETENCE_MAP: Record<string, number> = {
  "Not at all competent": 1,
  "Slightly competent": 2,
  "Moderately competent": 3,
  "Very competent": 4,
  "Extremely competent": 5,
};

const UNDERSTANDING_MAP: Record<string, number> = {
  "Very Limited": 1,
  Limited: 2,
  Moderate: 3,
  Comprehensive: 4,
  "Very Comprehensive": 5,
};

const CONFIDENCE_TITLECASE_MAP: Record<string, number> = {
  "Not at all Confident": 1,
  "Slightly Confident": 2,
  "Moderately Confident": 3,
  "Very Confident": 4,
  "Extremely Confident": 5,
};

function avg(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function ratingAvg(
  records: Airtable.Record<Airtable.FieldSet>[],
  field: string
): { avg: number | null; n: number } {
  const values: number[] = [];
  for (const r of records) {
    const v = r.get(field);
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  return { avg: avg(values), n: values.length };
}

function mappedAvg(
  records: Airtable.Record<Airtable.FieldSet>[],
  field: string,
  map: Record<string, number>
): { avg: number | null; n: number } {
  const values: number[] = [];
  for (const r of records) {
    const v = r.get(field);
    if (typeof v === "string" && v in map) values.push(map[v]);
  }
  return { avg: avg(values), n: values.length };
}

function upliftPair(
  records: Airtable.Record<Airtable.FieldSet>[],
  beforeField: string,
  afterField: string,
  map: Record<string, number>
) {
  const before = mappedAvg(records, beforeField, map);
  const after = mappedAvg(records, afterField, map);
  const uplift =
    before.avg !== null && after.avg !== null ? after.avg - before.avg : null;
  return { before: before.avg, after: after.avg, uplift, n: Math.min(before.n, after.n) };
}

export type TrainingCohort = "all" | "primary" | "secondary";

export async function getTeacherTrainingAgg(options: { event?: string; cohort?: TrainingCohort } = {}) {
  const { event, cohort = "all" } = options;
  const fields = [
    "I attended:",
    "Teacher Training",
    "Satisfaction wit the day",
    "How likely are you to recommend this training to other teachers?",
    "Primary - Prior to this training, how would you rate your overall confidence in teaching coding concepts?",
    "Primary - After completing this training, how would you rate your overall confidence in teaching coding concepts?",
    "Primary - Before attending this training, how would you rate your competence in the following coding concepts?",
    "Primary - Having completed this training, how would you rate your competence in the following coding concepts?",
    "Primary - Prior to this training, how would you rate your overall competence in teaching computational thinking skills?",
    "Primary - After attending this training, how would you rate your overall competence in teaching computational thinking skills?",
    "Secondary - Prior to this training, how would you rate your overall confidence in teaching coding concepts?",
    "Secondary - After completing this training, how would you rate your overall confidence in teaching coding concepts?",
    "Secondary - Before attending this training, how would you rate your competence in the following coding concepts?",
    "Secondary - Having completed this training, how would you rate your competence in the following coding concepts?",
    "Secondary - Prior to this training, how would you rate your overall competence in teaching computational thinking skills?",
    "Secondary - After attending this training, how would you rate your overall competence in teaching computational thinking skills?",
  ];

  const filter =
    "OR(" +
    [
      'LEN(ARRAYJOIN({I attended:}))>0',
      '{Satisfaction wit the day}>0',
      '{How likely are you to recommend this training to other teachers?}>0',
      "{Primary - Prior to this training, how would you rate your overall confidence in teaching coding concepts?}",
      "{Secondary - Prior to this training, how would you rate your overall confidence in teaching coding concepts?}",
    ].join(",") +
    ")";

  const allRecords = await fetchTable(TABLES.contacts, fields, filter);

  // Available filter values (facets) computed from the full filtered set.
  const facetEvents = countByMulti(toRows(allRecords, fields), "I attended:").map((c) => c.name);

  // Apply event filter client-side over the records (small N once filtered).
  let records = allRecords;
  if (event) {
    records = allRecords.filter((r) => {
      const v = r.get("I attended:");
      return Array.isArray(v) && v.some((x) => String(x) === event);
    });
  }

  const sat = ratingAvg(records, "Satisfaction wit the day");
  const nps = ratingAvg(
    records,
    "How likely are you to recommend this training to other teachers?"
  );

  const wantPrimary = cohort === "all" || cohort === "primary";
  const wantSecondary = cohort === "all" || cohort === "secondary";

  return {
    total: records.length,
    facets: { events: facetEvents.sort() },
    byEvent: countByMulti(toRows(records, fields), "I attended:"),
    byFormat: countByMulti(toRows(records, fields), "Teacher Training"),
    avgSatisfaction: sat.avg,
    satN: sat.n,
    avgRecommend: nps.avg,
    recommendN: nps.n,
    confidenceUplift: {
      primary: wantPrimary
        ? upliftPair(
            records,
            "Primary - Prior to this training, how would you rate your overall confidence in teaching coding concepts?",
            "Primary - After completing this training, how would you rate your overall confidence in teaching coding concepts?",
            CONFIDENCE_MAP
          )
        : { before: null, after: null, uplift: null, n: 0 },
      secondary: wantSecondary
        ? upliftPair(
            records,
            "Secondary - Prior to this training, how would you rate your overall confidence in teaching coding concepts?",
            "Secondary - After completing this training, how would you rate your overall confidence in teaching coding concepts?",
            CONFIDENCE_MAP
          )
        : { before: null, after: null, uplift: null, n: 0 },
    },
    competenceCodingUplift: {
      primary: wantPrimary
        ? upliftPair(
            records,
            "Primary - Before attending this training, how would you rate your competence in the following coding concepts?",
            "Primary - Having completed this training, how would you rate your competence in the following coding concepts?",
            COMPETENCE_MAP
          )
        : { before: null, after: null, uplift: null, n: 0 },
      secondary: wantSecondary
        ? upliftPair(
            records,
            "Secondary - Before attending this training, how would you rate your competence in the following coding concepts?",
            "Secondary - Having completed this training, how would you rate your competence in the following coding concepts?",
            COMPETENCE_MAP
          )
        : { before: null, after: null, uplift: null, n: 0 },
    },
    competenceThinkingUplift: {
      primary: wantPrimary
        ? upliftPair(
            records,
            "Primary - Prior to this training, how would you rate your overall competence in teaching computational thinking skills?",
            "Primary - After attending this training, how would you rate your overall competence in teaching computational thinking skills?",
            COMPETENCE_MAP
          )
        : { before: null, after: null, uplift: null, n: 0 },
      secondary: wantSecondary
        ? upliftPair(
            records,
            "Secondary - Prior to this training, how would you rate your overall competence in teaching computational thinking skills?",
            "Secondary - After attending this training, how would you rate your overall competence in teaching computational thinking skills?",
            COMPETENCE_MAP
          )
        : { before: null, after: null, uplift: null, n: 0 },
    },
  };
}

// ── Careers Days tab ────────────────────────────────────────────────

export async function getCareersDaysAgg(options: { event?: string } = {}) {
  const { event } = options;
  const fields = [
    "TF Careers day",
    "Bef - understanding tech careers",
    "Aft - understanding tech careers",
    "Bef - Confidence discussion tech careers",
    "Aft - Confidence discussion tech careers",
    "Bef - Confidence discussion tech impact",
    "Aft - Confidence discussion tech impact",
    "Bef - Confidence discussing AI impact",
    "Aft - Confidence discussing AI impact",
    "how students view tech careers",
    "why attending TF careers?",
    "2026 careers support",
  ];

  const filter = "{TF Careers day}";
  const allRecords = await fetchTable(TABLES.contacts, fields, filter);
  const facetEvents = countBy(toRows(allRecords, fields), "TF Careers day").map((c) => c.name);

  const records = event
    ? allRecords.filter((r) => String(r.get("TF Careers day") ?? "") === event)
    : allRecords;

  return {
    total: records.length,
    facets: { events: facetEvents.sort() },
    byEvent: countBy(toRows(records, fields), "TF Careers day"),
    understandingUplift: upliftPair(
      records,
      "Bef - understanding tech careers",
      "Aft - understanding tech careers",
      UNDERSTANDING_MAP
    ),
    confidenceCareersUplift: upliftPair(
      records,
      "Bef - Confidence discussion tech careers",
      "Aft - Confidence discussion tech careers",
      CONFIDENCE_TITLECASE_MAP
    ),
    confidenceImpactUplift: upliftPair(
      records,
      "Bef - Confidence discussion tech impact",
      "Aft - Confidence discussion tech impact",
      CONFIDENCE_TITLECASE_MAP
    ),
    confidenceAIUplift: upliftPair(
      records,
      "Bef - Confidence discussing AI impact",
      "Aft - Confidence discussing AI impact",
      CONFIDENCE_TITLECASE_MAP
    ),
    studentPerceptions: countByMulti(toRows(records, fields), "how students view tech careers"),
    whyAttending: countByMulti(toRows(records, fields), "why attending TF careers?"),
    wantedSupport: countByMulti(toRows(records, fields), "2026 careers support"),
  };
}
