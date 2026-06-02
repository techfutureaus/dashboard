// Pure JS aggregation helpers — runnable in both server and client.

export interface CountItem {
  name: string;
  count: number;
  [k: string]: string | number;
}

export type Row = Record<string, unknown>;

/** Count records by a string field (singleSelect / text). */
export function countBy(records: Row[], fieldName: string): CountItem[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const v = r[fieldName];
    if (v == null || v === "") continue;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count
  );
}

/** Count records by a multi-select array field (each value counted once per record). */
export function countByMulti(records: Row[], fieldName: string): CountItem[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const v = r[fieldName];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (item == null || item === "") continue;
      const key = String(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count
  );
}

/** Distinct sorted values from a single-value string field. */
export function distinctValues(records: Row[], fieldName: string): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const v = r[fieldName];
    if (v == null || v === "") continue;
    set.add(String(v));
  }
  return Array.from(set).sort();
}

/** Take the top N items (already sorted by count by default). */
export function topN<T>(items: T[], n: number): T[] {
  if (n <= 0) return items;
  return items.slice(0, n);
}

/** Alphabetical sort by name. */
export function sortAlpha(items: CountItem[]): CountItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/** Try to parse a leading year from a name like "2024", "2024 cadet", "Term 1 2024". */
function leadingYear(name: string): number | null {
  const m = name.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Sort items by extracted year, ascending; non-year items go to the end alpha-sorted. */
export function sortChronological(items: CountItem[]): CountItem[] {
  const withYear: { item: CountItem; year: number }[] = [];
  const noYear: CountItem[] = [];
  for (const item of items) {
    const y = leadingYear(item.name);
    if (y !== null) withYear.push({ item, year: y });
    else noYear.push(item);
  }
  withYear.sort((a, b) => a.year - b.year);
  noYear.sort((a, b) => a.name.localeCompare(b.name));
  return [...withYear.map((x) => x.item), ...noYear];
}
