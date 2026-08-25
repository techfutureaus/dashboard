// School lookup for the Teachers section: maps Umami distinct IDs (the random
// `analyticsId` each educator account carries) to the school recorded at
// signup. The mapping lives only in the main app's Firestore `users`
// collection, so reading it needs Firebase Admin credentials.
//
// Deliberately school-only: no names, emails, or uids leave this module —
// the dashboard's teacher rows stay pseudonymous (per the Aug 2026 decision).
//
// Needs FIREBASE_SERVICE_ACCOUNT (see firebase-admin.ts). Without it the
// report still works — teacher rows just show no school.

import { getAdminDb } from "./firebase-admin";

export interface SchoolInfo {
  school: string | null;
  schoolId: string | null;
}

/** True when a service account is configured and usable. */
export async function schoolsAvailable(): Promise<boolean> {
  return (await getAdminDb()) !== null;
}

/** analyticsId → school for the given ids. Missing ids are simply absent. */
export async function getSchoolsByAnalyticsId(
  analyticsIds: string[]
): Promise<Map<string, SchoolInfo>> {
  const out = new Map<string, SchoolInfo>();
  const ids = [...new Set(analyticsIds)].filter(Boolean);
  const db = await getAdminDb();
  if (!db || ids.length === 0) return out;

  // Firestore `in` queries take at most 30 values per query.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await db
        .collection("users")
        .where("analyticsId", "in", chunk)
        .select("analyticsId", "school", "schoolId")
        .get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (typeof d.analyticsId === "string") {
          out.set(d.analyticsId, {
            school: typeof d.school === "string" ? d.school : null,
            schoolId: typeof d.schoolId === "string" ? d.schoolId : null,
          });
        }
      }
    })
  );
  return out;
}
