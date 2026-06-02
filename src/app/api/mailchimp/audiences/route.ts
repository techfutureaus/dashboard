import { NextResponse } from "next/server";
import { listAudiencesSummary } from "@/lib/mailchimp";

// 24h — the list of audiences rarely changes.
export const revalidate = 86400;

export async function GET() {
  try {
    const audiences = await listAudiencesSummary();
    return NextResponse.json({ audiences });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Mailchimp audiences fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
