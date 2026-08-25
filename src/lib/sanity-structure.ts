// Course → lesson → page structure, read from the main site's public Sanity
// dataset. This is what makes the Website report self-updating: new courses,
// lessons, and pages published in the CMS appear here (and therefore in the
// dashboard) automatically — no dashboard change needed.
//
// The dataset is public read (same data the site itself renders), so no token
// is required.

const SANITY_PROJECT = process.env.SANITY_PROJECT_ID || "wu17sjme";
const SANITY_DATASET = process.env.SANITY_DATASET || "production";

export interface PageNode {
  slug: string;
  title: string;
}

export interface LessonNode {
  slug: string;
  title: string;
  pages: PageNode[];
}

export interface CourseNode {
  slug: string;
  title: string;
  lessons: LessonNode[];
}

// Lesson content is a mix of sections (grouping page references) and direct
// page references — flattened here into one ordered page list per lesson.
const STRUCTURE_QUERY = `*[_type == "course" && defined(slug.current)]{
  title,
  "slug": slug.current,
  "lessons": lessons[]->{
    title,
    "slug": slug.current,
    "content": content[]{
      _type == "section" => {"pages": pages[]->{title, "slug": slug.current}},
      _type == "reference" => {"page": @->{title, "slug": slug.current}}
    }
  }
}`;

type RawContent = {
  pages?: Array<{ title?: string; slug?: string } | null>;
  page?: { title?: string; slug?: string } | null;
};
type RawLesson = { title?: string; slug?: string; content?: RawContent[] };
type RawCourse = { title?: string; slug?: string; lessons?: RawLesson[] };

export async function getCourseStructure(): Promise<CourseNode[]> {
  const url = `https://${SANITY_PROJECT}.api.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${encodeURIComponent(
    STRUCTURE_QUERY
  )}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sanity structure query → ${res.status}`);
  }
  const { result } = (await res.json()) as { result: RawCourse[] };

  return (result ?? [])
    .filter((c): c is RawCourse & { slug: string } => !!c.slug)
    .map((c) => ({
      slug: c.slug,
      title: c.title ?? c.slug,
      lessons: (c.lessons ?? [])
        .filter((l): l is RawLesson & { slug: string } => !!l?.slug)
        .map((l) => ({
          slug: l.slug,
          title: l.title ?? l.slug,
          pages: (l.content ?? []).flatMap((entry) => {
            const nodes = entry.page ? [entry.page] : entry.pages ?? [];
            return nodes
              .filter((p): p is { title?: string; slug: string } => !!p?.slug)
              .map((p) => ({ slug: p.slug, title: p.title ?? p.slug }));
          }),
        })),
    }));
}
