/** Central registry of all unstable_cache tags so the refresh endpoint can bust them. */
export const TAGS = {
  airtableSchools: "airtable-schools",
  airtablePeople: "airtable-people",
  airtableImpact: "airtable-impact",
  airtableTeacherTraining: "airtable-teacher-training",
  airtableCareersDays: "airtable-careers-days",
  mailchimpAudiences: "mailchimp-audiences",
  mailchimpDashboard: "mailchimp-dashboard",
  ga4Properties: "ga4-properties",
  ga4Dashboard: "ga4-dashboard",
} as const;

export type CacheTag = (typeof TAGS)[keyof typeof TAGS];

export const ALL_TAGS: readonly CacheTag[] = Object.values(TAGS);
