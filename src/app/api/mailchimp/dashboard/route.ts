import { NextRequest, NextResponse } from "next/server";
import { getCombinedDashboardData, getDashboardForList } from "@/lib/mailchimp";

// 6h cache — campaign metrics drift through the day as opens/clicks come in.
// Next.js keys per-URL so each ?listId combo caches independently.
export const revalidate = 21600;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listId = searchParams.get("listId") || "";
    const data =
      !listId || listId === "combined"
        ? await getCombinedDashboardData()
        : await getDashboardForList(listId);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Mailchimp dashboard fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
