import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { ALL_TAGS, TAGS } from "@/lib/cache-tags";

/**
 * Bust one or all cache tags. Used by:
 * - The manual refresh button in the sidebar (POST without args)
 * - The 25h auto-refresh in each hook (POST with ?source=<tag>)
 * - The Vercel weekly cron (GET ?source=all)
 */
// Next.js 16 requires a cache-life profile arg. "default" matches what
// unstable_cache uses internally and re-validates immediately.
const PROFILE = "default";

async function refresh(source: string) {
  if (source === "all" || !source) {
    ALL_TAGS.forEach((t) => revalidateTag(t, PROFILE));
    return NextResponse.json({ ok: true, busted: ALL_TAGS });
  }

  const allowed = Object.values(TAGS) as string[];
  if (!allowed.includes(source)) {
    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
  }
  revalidateTag(source, PROFILE);
  return NextResponse.json({ ok: true, busted: [source] });
}

export async function GET(request: NextRequest) {
  // GET supports Vercel cron jobs (they send GET requests).
  const source = request.nextUrl.searchParams.get("source") || "all";
  return refresh(source);
}

export async function POST(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "all";
  return refresh(source);
}
