import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

/** Build a JSON response with an X-Fetched-At header reflecting when the underlying data was fetched. */
export function jsonWithTimestamp(data: unknown, fetchedAt: string) {
  return NextResponse.json(data, {
    headers: { "X-Fetched-At": fetchedAt },
  });
}

/**
 * Wrap a fetcher so its result is cached AND stamped with the time of actual fetch.
 *
 * Important: the timestamp is captured *inside* the cached function, so when the
 * cache returns a hit, you get the original fetch time — exactly what we want
 * for the "Updated X ago" badge.
 */
export function cached<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  baseKey: string,
  options: { revalidate: number; tags: string[] }
): (...args: TArgs) => Promise<{ data: TResult; fetchedAt: string }> {
  return unstable_cache(
    async (...args: TArgs) => {
      const data = await fn(...args);
      return { data, fetchedAt: new Date().toISOString() };
    },
    [baseKey],
    options
  );
}
