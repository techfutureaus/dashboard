import {
  startOfDay,
  endOfDay,
  subDays,
  subWeeks,
  startOfQuarter,
  startOfYear,
} from "date-fns";

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface DatePreset {
  id: string;
  label: string;
  shortLabel: string;
  range: () => DateRange;
}

export const PRESETS: DatePreset[] = [
  {
    id: "7d",
    label: "Last 7 days",
    shortLabel: "Last 7 days",
    range: () => ({
      start: startOfDay(subDays(new Date(), 6)),
      end: endOfDay(new Date()),
    }),
  },
  {
    id: "4w",
    label: "Last 4 weeks",
    shortLabel: "Last 4 weeks",
    range: () => ({
      start: startOfDay(subWeeks(new Date(), 4)),
      end: endOfDay(new Date()),
    }),
  },
  {
    id: "qtd",
    label: "Quarter to date",
    shortLabel: "QTD",
    range: () => ({
      start: startOfQuarter(new Date()),
      end: endOfDay(new Date()),
    }),
  },
  {
    id: "ytd",
    label: "Year to date",
    shortLabel: "YTD",
    range: () => ({
      start: startOfYear(new Date()),
      end: endOfDay(new Date()),
    }),
  },
  {
    id: "all",
    label: "All time",
    shortLabel: "All time",
    range: () => ({ start: null, end: null }),
  },
];

export function matchesPreset(range: DateRange, preset: DatePreset): boolean {
  const p = preset.range();
  if (!p.start && !range.start && !p.end && !range.end) return true;
  if (!p.start || !p.end || !range.start || !range.end) return false;
  // Tolerance: within 1 minute, since preset calls use new Date() each call.
  return (
    Math.abs(p.start.getTime() - range.start.getTime()) < 60_000 &&
    Math.abs(p.end.getTime() - range.end.getTime()) < 60_000
  );
}

export function defaultRange(): DateRange {
  // All time by default — matches behavior before date filtering was added.
  return { start: null, end: null };
}
