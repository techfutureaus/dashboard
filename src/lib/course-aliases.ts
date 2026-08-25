// The AI course launched as "ai-course" and was renamed to "intro-to-ai" on
// 25 Jul 2026 (see the Sanity redirect) — real events from the first days
// carry the old slug, so every report folds it into the current one.
export const COURSE_SLUG_ALIASES: Record<string, string> = {
  "ai-course": "intro-to-ai",
};

export const aliasCourse = (slug: string) => COURSE_SLUG_ALIASES[slug] ?? slug;
