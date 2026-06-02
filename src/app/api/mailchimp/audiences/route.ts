import { listAudiencesSummary } from "@/lib/mailchimp";
import { jsonWithTimestamp } from "@/lib/api-response";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { data: audiences, fetchedAt } = await listAudiencesSummary();
    return jsonWithTimestamp({ audiences }, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Mailchimp audiences fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
