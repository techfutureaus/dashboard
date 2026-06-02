import { NextRequest, NextResponse } from "next/server";
import { getDashboard, listProperties } from "@/lib/ga4";

// 12h cache. Next.js keys the data cache by full URL so different
// propertyId / date-range combos cache separately.
export const revalidate = 43200;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const start = searchParams.get("start") || "365daysAgo";
    const end = searchParams.get("end") || "today";

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId required" }, { status: 400 });
    }

    // Resolve display name for the property
    const properties = await listProperties();
    const property = properties.find((p) => p.id === propertyId);
    if (!property) {
      return NextResponse.json({ error: "property not found" }, { status: 404 });
    }

    const data = await getDashboard(propertyId, property, { start, end });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GA4 dashboard fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
