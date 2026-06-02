import { NextRequest, NextResponse } from "next/server";
import { getCombinedDashboardData, getDashboardForList } from "@/lib/mailchimp";
import { jsonWithTimestamp } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listId = searchParams.get("listId") || "";
    const { data, fetchedAt } =
      !listId || listId === "combined"
        ? await getCombinedDashboardData()
        : await getDashboardForList(listId);
    return jsonWithTimestamp(data, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Mailchimp dashboard fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
