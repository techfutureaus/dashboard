import { NextRequest, NextResponse } from "next/server";
import { runRollup } from "@/lib/rollup";

// Weekly Umami → Firestore archive (vercel.json cron, Mondays ~3am Sydney).
// The route is outside the dashboard's password wall (Vercel cron can't log
// in), so it authenticates itself: the cron's Bearer CRON_SECRET header, or —
// for manual runs from a logged-in browser — the session cookie.
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }
  const password = process.env.DASHBOARD_PASSWORD;
  if (password && request.cookies.get("session")?.value === password) {
    return true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const result = await runRollup({
      dryRun: searchParams.get("dry") === "1",
      maxDays: searchParams.get("days") ? Number(searchParams.get("days")) : undefined,
    });
    // Keep the response light unless a sample is asked for (?sample=1).
    if (searchParams.get("sample") !== "1") delete result.sample;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Rollup failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
